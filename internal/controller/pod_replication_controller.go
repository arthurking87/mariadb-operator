package controller

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/go-logr/logr"
	"github.com/hashicorp/go-multierror"
	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/controller/endpoints"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/controller/replication"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/statefulset"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/events"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"
)

var (
	ErrDelayAutomaticFailover = errors.New("delaying automatic failover")
)

// PodReplicationController reconciles a Pod object
type PodReplicationController struct {
	client.Client
	recorder            events.EventRecorder
	endpointsReconciler *endpoints.EndpointsReconciler
}

func NewPodReplicationController(client client.Client, recorder events.EventRecorder,
	endpointsReconciler *endpoints.EndpointsReconciler) PodReadinessController {
	return &PodReplicationController{
		Client:              client,
		recorder:            recorder,
		endpointsReconciler: endpointsReconciler,
	}
}

func (r *PodReplicationController) ReconcilePodReady(ctx context.Context, pod corev1.Pod, mariadb *mariadbv1alpha1.MariaDB) error {
	logger := log.FromContext(ctx).WithName("pod-replication")
	if mariadb.Status.CurrentPrimaryPodIndex == nil {
		logger.V(1).Info("'status.currentPrimaryPodIndex' must be set. Skipping")
		return nil
	}
	logger.V(1).Info("Reconciling Pod in Ready state", "pod", pod.Name)

	index, err := statefulset.PodIndex(pod.Name)
	if err != nil {
		return fmt.Errorf("error getting Pod index: %v", err)
	}
	if *index != *mariadb.Status.CurrentPrimaryPodIndex {
		// This pod is a replica. Ensure it is registered in the secondary-svc endpoint.
		secondaryServiceKey := mariadb.SecondaryServiceKey()
		if _, err := r.endpointsReconciler.Reconcile(ctx, secondaryServiceKey, mariadb, secondaryServiceKey.Name); err != nil {
			return fmt.Errorf("error reconciling secondary service endpoints for replica pod '%s': %v", pod.Name, err)
		}
		return nil
	}

	if mariadb.Status.CurrentPrimaryFailingSince != nil {
		return r.patchStatus(ctx, mariadb, func(status *mariadbv1alpha1.MariaDBStatus) {
			status.CurrentPrimaryFailingSince = nil
		})
	}

	return nil
}

func (r *PodReplicationController) ReconcilePodNotReady(ctx context.Context, pod corev1.Pod, mariadb *mariadbv1alpha1.MariaDB) error {
	if !shouldReconcile(mariadb) {
		return nil
	}
	logger := log.FromContext(ctx).WithName("pod-replication")
	if mariadb.Status.CurrentPrimaryPodIndex == nil {
		logger.V(1).Info("'status.currentPrimaryPodIndex' must be set. Skipping")
		return nil
	}
	logger.V(1).Info("Reconciling Pod in non Ready state", "pod", pod.Name)

	index, err := statefulset.PodIndex(pod.Name)
	if err != nil {
		return fmt.Errorf("error getting Pod index: %v", err)
	}
	if *index != *mariadb.Status.CurrentPrimaryPodIndex {
		// This pod is a replica. Ensure it is removed from the secondary-svc endpoint.
		secondaryServiceKey := mariadb.SecondaryServiceKey()
		if _, err := r.endpointsReconciler.Reconcile(ctx, secondaryServiceKey, mariadb, secondaryServiceKey.Name); err != nil {
			return fmt.Errorf("error reconciling secondary service endpoints for replica pod '%s': %v", pod.Name, err)
		}
		return nil
	}

	now := time.Now()

	if mariadb.Status.CurrentPrimaryFailingSince == nil {
		err := r.patchStatus(ctx, mariadb, func(status *mariadbv1alpha1.MariaDBStatus) {
			status.CurrentPrimaryFailingSince = &metav1.Time{Time: now}
		})
		if err != nil {
			return fmt.Errorf("error patching MariaDB: %v", err)
		}
	}

	autoFailoverDelay := mariadb.GetAutomaticFailoverDelay()
	if autoFailoverDelay > 0 {
		failoverTime := mariadb.Status.CurrentPrimaryFailingSince.Add(autoFailoverDelay)
		if failoverTime.After(now) {
			// To delay automatic failover we must abort and requeue later.
			// When the 'PodController' controller receives the 'ErrDelayAutomaticFailover' error, it requeues without error.
			// See: https://github.com/mariadb-operator/mariadb-operator/pull/1287
			return ErrDelayAutomaticFailover
		}
	}

	primary := mariadb.Status.CurrentPrimaryPodIndex

	newPrimaryName, err := replication.NewFailoverHandler(
		r.Client,
		mariadb,
		log.FromContext(ctx).WithName("failover").V(1),
	).FurthestAdvancedReplica(ctx)
	if err != nil {
		if errors.Is(err, replication.ErrNoFailoverCandidate) {
			// FurthestAdvancedReplica already filters out replicas with a dead
			// IO/SQL thread, unset GTID position, or relay log events still
			// pending (see findCandidates in failover.go) — if it comes back
			// empty, every replica is currently unhealthy too. CurrentPrimaryFailingSince
			// stays set, so we keep monitoring and will attempt failover again
			// later, but propagate the sentinel error rather than swallowing it
			// (returning nil here): with no error, the caller (PodController.Reconcile)
			// returns ctrl.Result{} with no requeue, and once this Pod's readiness
			// stops changing, PodController's watch predicate (podHasChanged) means
			// nothing else re-triggers this reconcile either — a replica recovering
			// triggers its OWN reconcile via ReconcilePodReady, not this primary Pod's.
			// Failover would be stuck forever until something else about this exact
			// Pod object changes. PodController.Reconcile requeues on this sentinel
			// after a fixed delay (see noFailoverCandidateRequeueInterval), the same
			// pattern already used for ErrDelayAutomaticFailover below.
			logger.Info("No viable failover candidate found, keeping current primary", "primary", *primary, "reason", err.Error())
			r.recorder.Eventf(mariadb, nil, corev1.EventTypeWarning, mariadbv1alpha1.ReasonNoFailoverCandidate, mariadbv1alpha1.ActionReconciling,
				"No viable failover candidate found for primary '%d': %v", *primary, err)
			return err
		}
		// Any other error (e.g. failing to list secondary Pods) is a transient lookup
		// failure, not evidence that every replica is unhealthy — propagate it so the
		// caller requeues-with-backoff and retries, instead of silently keeping the
		// current (still failing) primary in place.
		return fmt.Errorf("error getting promotion candidate: %v", err)
	}
	newPrimary, err := statefulset.PodIndex(newPrimaryName)
	if err != nil {
		return fmt.Errorf("error getting new primary Pod index: %v", err)
	}

	return r.promoteReplica(ctx, pod, mariadb, primary, newPrimary, logger)
}

// promoteReplica deletes the old primary Pod and promotes newPrimary to be the new primary,
// patching mariadb accordingly. primary and newPrimary are the resolved old and new primary
// Pod indexes respectively.
func (r *PodReplicationController) promoteReplica(ctx context.Context, pod corev1.Pod, mariadb *mariadbv1alpha1.MariaDB,
	primary, newPrimary *int, logger logr.Logger) error {
	// The old primary may still be holding application connections open (e.g. it is
	// NotReady due to a failed health check rather than a crashed mariadbd process),
	// which would otherwise sit until the client times out. Deleting it forces those
	// connections closed and lets the StatefulSet recreate it cleanly as a replica.
	//
	// This runs before the Primary.PodIndex patch below on purpose: once that patch lands,
	// spec.replication.primary.podIndex differs from status.currentPrimaryPodIndex, which
	// makes shouldReconcile (via IsReplicationSwitchoverRequired) return false on the next
	// reconcile, and hands control over to the switchover reconciler instead — so a Delete
	// failure here would otherwise have no independent retry path. Keeping the Delete first
	// means a transient failure just requeues this same reconcile from the top, with nothing
	// patched yet, so it naturally retries until the Pod is actually gone.
	//
	// The UID precondition guards against deleting a different Pod instance than the one we
	// observed: if the old primary was already recreated with the same name between us
	// reading it and issuing the Delete, a name-only Delete could remove the new instance.
	if err := r.Delete(ctx, &pod, client.Preconditions{UID: &pod.UID}); client.IgnoreNotFound(err) != nil {
		return fmt.Errorf("error deleting Pod '%s': %v", pod.Name, err)
	}

	var errBundle *multierror.Error
	err := r.patch(ctx, mariadb, func(mdb *mariadbv1alpha1.MariaDB) {
		mdb.Spec.Replication.Primary.PodIndex = newPrimary
	})
	errBundle = multierror.Append(errBundle, err)

	err = r.patchStatus(ctx, mariadb, func(status *mariadbv1alpha1.MariaDBStatus) {
		status.CurrentPrimaryFailingSince = nil
	})
	errBundle = multierror.Append(errBundle, err)

	if err := errBundle.ErrorOrNil(); err != nil {
		return fmt.Errorf("error patching MariaDB: %v", err)
	}

	logger.Info("Switching primary", "primary", primary, "new-primary", *newPrimary)
	r.recorder.Eventf(mariadb, nil, corev1.EventTypeNormal, mariadbv1alpha1.ReasonPrimarySwitching, mariadbv1alpha1.ActionReconciling,
		"Switching primary from index '%d' to index '%d'", *primary, *newPrimary)

	return nil
}

func shouldReconcile(mdb *mariadbv1alpha1.MariaDB) bool {
	if mdb.IsMaxScaleEnabled() || mdb.IsSwitchingPrimary() || mdb.IsReplicationSwitchoverRequired() ||
		mdb.IsRestoringBackup() || mdb.IsResizingStorage() || mdb.IsSuspended() {
		return false
	}
	primaryRepl := ptr.Deref(mdb.Spec.Replication, mariadbv1alpha1.Replication{}).Primary
	autoFailover := ptr.Deref(primaryRepl.AutoFailover, true)
	return mdb.IsReplicationEnabled() && autoFailover && mdb.HasConfiguredReplica()
}

func (r *PodReplicationController) patch(ctx context.Context, mariadb *mariadbv1alpha1.MariaDB,
	patcher func(*mariadbv1alpha1.MariaDB)) error {
	patch := client.MergeFrom(mariadb.DeepCopy())
	patcher(mariadb)

	if err := r.Patch(ctx, mariadb, patch); err != nil {
		return fmt.Errorf("error patching MariaDB: %v", err)
	}
	return nil
}

func (r *PodReplicationController) patchStatus(ctx context.Context, mariadb *mariadbv1alpha1.MariaDB,
	patcher func(*mariadbv1alpha1.MariaDBStatus)) error {
	patch := client.MergeFrom(mariadb.DeepCopy())
	patcher(&mariadb.Status)

	if err := r.Client.Status().Patch(ctx, mariadb, patch); err != nil {
		return fmt.Errorf("error patching MariaDB status: %v", err)
	}
	return nil
}
