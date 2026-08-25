package controller

import (
	"context"
	"errors"
	"time"

	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/controller/replication"
	mariadbpod "github.com/mariadb-operator/mariadb-operator/v26/pkg/pod"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/predicate"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/refresolver"
	corev1 "k8s.io/api/core/v1"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"
)

// noFailoverCandidateRequeueInterval bounds how long ReconcilePodNotReady's
// replication.ErrNoFailoverCandidate is left unretried. Long enough not to hammer
// FurthestAdvancedReplica's lookup in a tight loop while every replica is unhealthy, short enough
// that failover picks back up promptly once one recovers.
const noFailoverCandidateRequeueInterval = 15 * time.Second

type PodReadinessController interface {
	ReconcilePodReady(context.Context, corev1.Pod, *mariadbv1alpha1.MariaDB) error
	ReconcilePodNotReady(context.Context, corev1.Pod, *mariadbv1alpha1.MariaDB) error
}

// PodController reconciles a Pod object
type PodController struct {
	client.Client
	name                   string
	refResolver            *refresolver.RefResolver
	podReadinessController PodReadinessController
	podAnnotations         []string
}

func NewPodController(name string, client client.Client, refResolver *refresolver.RefResolver,
	podReadinessController PodReadinessController, podAnnotations []string) *PodController {
	return &PodController{
		Client:                 client,
		name:                   name,
		refResolver:            refResolver,
		podReadinessController: podReadinessController,
		podAnnotations:         podAnnotations,
	}
}

//+kubebuilder:rbac:groups="",resources=pods,verbs=get;list;watch

// Reconcile is part of the main kubernetes reconciliation loop which aims to
// move the current state of the cluster closer to the desired state.
func (r *PodController) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	var pod corev1.Pod
	if err := r.Get(ctx, req.NamespacedName, &pod); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	mariadb, err := r.refResolver.MariaDBFromAnnotation(ctx, pod.ObjectMeta)
	if err != nil {
		if errors.Is(err, refresolver.ErrMariaDBAnnotationNotFound) {
			return ctrl.Result{}, nil
		}
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	if mariadbpod.PodReady(&pod) {
		if err := r.podReadinessController.ReconcilePodReady(ctx, pod, mariadb); err != nil {
			log.FromContext(ctx).V(1).Info("Error reconciling Pod in Ready state", "pod", pod.Name)
			return ctrl.Result{Requeue: true}, nil
		}
	} else {
		if err := r.podReadinessController.ReconcilePodNotReady(ctx, pod, mariadb); err != nil {
			if errors.Is(err, ErrDelayAutomaticFailover) {
				log.FromContext(ctx).V(1).Info("Delaying primary switchover. Skipping reconciliation of Pod in non Ready state", "pod", pod.Name)
				return ctrl.Result{RequeueAfter: 1 * time.Second}, nil
			}
			if errors.Is(err, replication.ErrNoFailoverCandidate) {
				// Requeue after a fixed delay instead of erroring out: returning the error here
				// would hit the default rate-limited backoff, retrying the exact same failing
				// lookup in a tight loop; returning ctrl.Result{} with a nil error (like the
				// old behavior) would never requeue at all once this Pod's readiness stops
				// changing (see the comment on this sentinel in ReconcilePodNotReady).
				log.FromContext(ctx).V(1).Info("No failover candidate available yet, retrying later", "pod", pod.Name)
				return ctrl.Result{RequeueAfter: noFailoverCandidateRequeueInterval}, nil
			}
			log.FromContext(ctx).V(1).Info("Error reconciling Pod in non Ready state", "pod", pod.Name)
			return ctrl.Result{Requeue: true}, nil
		}
	}
	return ctrl.Result{}, nil
}

// SetupWithManager sets up the controller with the Manager.
func (r *PodController) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		Named(r.name).
		For(&corev1.Pod{}).
		WithEventFilter(
			predicate.PredicateChangedWithAnnotations(
				r.podAnnotations,
				podHasChanged,
			),
		).
		Complete(r)
}

func podHasChanged(old, new client.Object) bool {
	oldPod, ok := old.(*corev1.Pod)
	if !ok {
		return false
	}
	newPod, ok := new.(*corev1.Pod)
	if !ok {
		return false
	}
	return mariadbpod.PodReady(oldPod) != mariadbpod.PodReady(newPod)
}
