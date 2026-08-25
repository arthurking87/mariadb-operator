package replication

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/go-logr/logr"
	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	condition "github.com/mariadb-operator/mariadb-operator/v26/pkg/condition"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/metrics"
	mariadbpod "github.com/mariadb-operator/mariadb-operator/v26/pkg/pod"
	mdbreplic "github.com/mariadb-operator/mariadb-operator/v26/pkg/replication"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/sql"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/statefulset"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/wait"
	"golang.org/x/sync/errgroup"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/utils/ptr"
)

const (
	metricResultSuccess = "success"
	metricResultFailure = "failure"
)

// recordSwitchoverResult records the top-level switchover metrics exactly once for a
// given switchover, at whichever reconcile call reaches a terminal outcome (success or
// a non-retryable failure). It must not be called from phases that will be retried.
func recordSwitchoverResult(ns, mdbName, fromIndex, toIndex string, start time.Time, result string) {
	duration := time.Since(start).Seconds()
	metrics.SwitchoverDuration.WithLabelValues(ns, mdbName, result).Observe(duration)
	metrics.SwitchoverLastDuration.WithLabelValues(ns, mdbName).Set(duration)
	metrics.SwitchoverTotal.WithLabelValues(ns, mdbName, fromIndex, toIndex, result).Inc()
}

type switchoverPhase struct {
	name      string
	reconcile func(context.Context, *ReconcileRequest, logr.Logger) error
	// afterSuccess, if set, runs right after reconcile succeeds, before moving on to the next
	// phase. Used to persist progress that a retry needs to know about.
	afterSuccess func(context.Context, *ReconcileRequest, logr.Logger) error
	// resumePoint marks the phase a retry should resume from once IsNewPrimaryConfigured is true.
	resumePoint bool
	// rollbackOnFailure indicates whether a failure in this phase can still be safely rolled
	// back by restoring the current primary's write access. Once "Configure new primary" has
	// succeeded, the new primary is already writable, so restoring the old primary's write
	// access too would risk a dual-writable cluster — later phases must not roll back.
	rollbackOnFailure bool
}

// waitSyncPhaseName identifies the "Wait sync" phase, whose cumulative retry time across
// reconciles is bounded by replication.Primary.SwitchoverTimeout, independently of the other phases.
const waitSyncPhaseName = "Wait sync"

func isSwitchoverStale(mdb *mariadbv1alpha1.MariaDB) bool {
	return mdb.IsSwitchingPrimary() && !mdb.IsReplicationSwitchoverRequired()
}

func shouldReconcileSwitchover(mdb *mariadbv1alpha1.MariaDB) bool {
	if mdb.IsMaxScaleEnabled() || mdb.IsRestoringBackup() || mdb.IsResizingStorage() {
		return false
	}
	if !mdb.HasConfiguredReplica() {
		return false
	}
	return mdb.IsReplicationSwitchoverRequired()
}

// switchoverPhases returns the ordered list of phases reconcileSwitchover runs through. Extracted
// into its own function (rather than an inline literal) so the rollbackOnFailure/resumePoint
// invariants below can be asserted directly in a unit test, without needing a full reconcile:
//   - every phase up to and including "Wait sync" must have rollbackOnFailure true, since the old
//     primary is still the only writable node up to that point;
//   - "Configure new primary" and every phase after it must have rollbackOnFailure false, since the
//     new primary may already be writable by the time any of them fails.
func (r *ReplicationReconciler) switchoverPhases() []switchoverPhase {
	return []switchoverPhase{
		{
			name:              "Lock primary with read lock",
			reconcile:         r.lockPrimaryWithReadLock,
			rollbackOnFailure: true,
		},
		{
			name:              "Set read_only in primary",
			reconcile:         r.setPrimaryReadOnly,
			rollbackOnFailure: true,
		},
		{
			name:              waitSyncPhaseName,
			reconcile:         r.waitSync,
			rollbackOnFailure: true,
		},
		{
			name:      "Configure new primary",
			reconcile: r.configureNewPrimary,
			// Once this phase's reconcile func returns, the new primary may already be
			// writable even on failure (ConfigurePrimary can fail partway through, after
			// DisableReadOnly already ran) — restoring the old primary's write access here
			// or in any later phase would risk a dual-writable cluster.
			rollbackOnFailure: false,
			afterSuccess:      r.markNewPrimaryConfigured,
		},
		{
			name:              "Connect replicas to new primary",
			reconcile:         r.connectReplicasToNewPrimary,
			rollbackOnFailure: false,
			// The phase to resume from when a previous attempt already got through "Configure
			// new primary" (see the IsNewPrimaryConfigured check below).
			resumePoint: true,
		},
		{
			name:              "Change primary to replica",
			reconcile:         r.changePrimaryToReplica,
			rollbackOnFailure: false,
		},
	}
}

func (r *ReplicationReconciler) reconcileSwitchover(ctx context.Context, req *ReconcileRequest, switchoverLogger logr.Logger) error {
	logger := switchoverLogger.WithValues("mariadb", req.mariadb.Name)

	currentPrimaryReady, err := r.currentPrimaryReady(ctx, req.mariadb, req.replClientSet)
	if err != nil {
		return fmt.Errorf("error getting current primary readiness: %v", err)
	}
	req.currentPrimaryReady = currentPrimaryReady

	if err := r.reconcileStaleSwitchover(ctx, req, logger); err != nil {
		return fmt.Errorf("error reconciling stale switchover: %v", err)
	}
	if !shouldReconcileSwitchover(req.mariadb) {
		return nil
	}

	replication := ptr.Deref(req.mariadb.Spec.Replication, mariadbv1alpha1.Replication{})
	primary := req.mariadb.Status.CurrentPrimaryPodIndex
	newPrimary := *replication.Primary.PodIndex
	newPrimaryPodName := statefulset.PodName(req.mariadb.ObjectMeta, *replication.Primary.PodIndex)
	logger = logger.WithValues("primary", primary, "new-primary", newPrimary)

	if err := r.patchStatus(ctx, req.mariadb, func(status *mariadbv1alpha1.MariaDBStatus) {
		condition.SetPrimarySwitching(&req.mariadb.Status, newPrimaryPodName)
	}); err != nil {
		return fmt.Errorf("error patching MariaDB status: %v", err)
	}

	phases := r.switchoverPhases()

	if req.mariadb.IsNewPrimaryConfigured(newPrimaryPodName) {
		// A previous attempt already got through "Configure new primary" before a later phase
		// failed (e.g. the primary Pod was replaced mid-switchover and the connection used to
		// release its read lock died). Restarting from "Lock primary with read lock" would
		// re-run "Wait sync", comparing replicas against the OLD primary's GTID — but the new
		// primary is already writable and no longer replicating from it, so it can never reach
		// that GTID again. Resume from the resumePoint phase instead, to avoid that livelock.
		for i, p := range phases {
			if p.resumePoint {
				phases = phases[i:]
				break
			}
		}
		logger.Info("Resuming switchover: new primary was already configured in a previous attempt")
	}

	ns := req.mariadb.Namespace
	mdbName := req.mariadb.Name

	fromIndex := strconv.Itoa(int(*primary))
	toIndex := strconv.Itoa(int(newPrimary))

	// A single switchover spans multiple reconcile calls: every retry re-enters this
	// function from the first phase. Use the PrimarySwitched condition's
	// LastTransitionTime as the switchover start instead of time.Now(), since
	// meta.SetStatusCondition only bumps it when the Status value actually changes,
	// so it keeps pointing at when this switchover first began across retries.
	switchoverStart := time.Now()
	if cond := meta.FindStatusCondition(req.mariadb.Status.Conditions, mariadbv1alpha1.ConditionTypePrimarySwitched); cond != nil {
		switchoverStart = cond.LastTransitionTime.Time
	}

	for _, p := range phases {
		phaseStart := time.Now()
		phaseErr := p.reconcile(ctx, req, logger.WithValues("phase", p.name))
		phaseDuration := time.Since(phaseStart).Seconds()
		phaseResult := metricResultSuccess
		if phaseErr != nil {
			phaseResult = metricResultFailure
		}
		phaseLabel := strings.ToLower(strings.ReplaceAll(p.name, " ", "_"))
		metrics.SwitchoverPhaseDuration.WithLabelValues(ns, mdbName, phaseLabel, phaseResult).Observe(phaseDuration)
		metrics.SwitchoverPhaseLastDuration.WithLabelValues(ns, mdbName, phaseLabel).Set(phaseDuration)

		if phaseErr != nil {
			// Only record the switchover as terminally failed when it won't be retried
			// (the MariaDB/Pod/etc. it depends on is gone). Any other phase error is
			// transient and will re-enter this function on the next reconcile, so
			// recording it here would count one logical switchover multiple times.
			if apierrors.IsNotFound(phaseErr) {
				recordSwitchoverResult(ns, mdbName, fromIndex, toIndex, switchoverStart, metricResultFailure)
				return phaseErr
			}
			if p.name == waitSyncPhaseName {
				return r.handleWaitSyncFailure(ctx, req, logger, replication, phaseErr)
			}
			// A failure before the new primary is configured would otherwise leave the primary
			// locked + read-only indefinitely: isSwitchoverStale() doesn't catch this, because the
			// switchover is still "required" from the spec's point of view
			// (status.currentPrimaryPodIndex was never updated), so the next
			// reconcile just retries the same phases from "Lock primary with
			// read lock" again instead of going through the stale-switchover
			// recovery path. Roll back write access so the cluster isn't stuck
			// rejecting writes while switchover keeps retrying. The read lock itself is
			// always released regardless of the phase, since holding FLUSH TABLES WITH
			// READ LOCK indefinitely would block writes cluster-wide.
			if rollbackErr := r.rollbackSwitchover(ctx, req, logger, p.rollbackOnFailure); rollbackErr != nil {
				logger.Error(rollbackErr, "error rolling back switchover after failed phase", "phase", p.name)
			}
			if !p.rollbackOnFailure {
				logger.Error(phaseErr, "switchover failed after the new primary was configured; "+
					"leaving the old primary read-only to avoid a dual-writable cluster", "phase", p.name)
			}
			return fmt.Errorf("error in %s switchover reconcile phase: %v", p.name, phaseErr)
		}
		if p.afterSuccess != nil {
			if err := p.afterSuccess(ctx, req, logger.WithValues("phase", p.name)); err != nil {
				return fmt.Errorf("error finalizing %s switchover reconcile phase: %v", p.name, err)
			}
		}
		if p.name == waitSyncPhaseName {
			if err := r.patchStatus(ctx, req.mariadb, func(status *mariadbv1alpha1.MariaDBStatus) {
				condition.SetReplicationSynced(&req.mariadb.Status)
			}); err != nil {
				return fmt.Errorf("error patching MariaDB status: %v", err)
			}
		}
	}

	if err := r.patchStatus(ctx, req.mariadb, func(status *mariadbv1alpha1.MariaDBStatus) {
		status.UpdateCurrentPrimary(req.mariadb, newPrimary)
		condition.SetPrimarySwitched(&req.mariadb.Status)
		// Otherwise it would leak into a future, unrelated switchover that targets the same Pod
		// index again, wrongly making it skip straight to "Connect replicas to new primary".
		status.RemoveCondition(mariadbv1alpha1.ConditionTypeNewPrimaryConfigured)
	}); err != nil {
		return fmt.Errorf("error patching MariaDB status: %v", err)
	}
	recordSwitchoverResult(ns, mdbName, fromIndex, toIndex, switchoverStart, metricResultSuccess)

	logger.Info("Primary switched")
	r.recorder.Eventf(req.mariadb, nil, corev1.EventTypeNormal, mariadbv1alpha1.ReasonPrimarySwitched,
		mariadbv1alpha1.ActionReconciling, "Primary switched from index '%d' to index '%d'", *primary, newPrimary)
	return nil
}

// markNewPrimaryConfigured persists that the new primary has already been made writable, so that
// if a later phase fails, the retry can resume from "Connect replicas to new primary" instead of
// restarting the whole sequence (see the IsNewPrimaryConfigured check in reconcileSwitchover).
func (r *ReplicationReconciler) markNewPrimaryConfigured(ctx context.Context, req *ReconcileRequest, logger logr.Logger) error {
	newPrimary := *ptr.Deref(req.mariadb.Spec.Replication, mariadbv1alpha1.Replication{}).Primary.PodIndex
	newPrimaryPodName := statefulset.PodName(req.mariadb.ObjectMeta, newPrimary)
	return r.patchStatus(ctx, req.mariadb, func(status *mariadbv1alpha1.MariaDBStatus) {
		condition.SetNewPrimaryConfigured(&req.mariadb.Status, newPrimaryPodName)
	})
}

// rollbackSwitchover releases the primary's read lock and, if restoreWriteAccess is set,
// restores its write access after a switchover phase fails partway through (after the
// primary was already locked/set read-only by lockPrimaryWithReadLock/setPrimaryReadOnly).
// The read lock is always released if held: leaving FLUSH TABLES WITH READ LOCK in place
// indefinitely would block writes cluster-wide, and releasing it doesn't by itself make the
// primary writable again (read_only is a separate guard). restoreWriteAccess must only be
// set once the new primary hasn't already been made writable, otherwise both primaries could
// end up writable at once. DisableReadOnly is safe to call even if the primary was never
// actually set read-only yet (e.g. the failure happened in that phase itself): it's a no-op
// in that case.
func (r *ReplicationReconciler) rollbackSwitchover(ctx context.Context, req *ReconcileRequest, logger logr.Logger,
	restoreWriteAccess bool) error {
	if !req.currentPrimaryReady {
		return nil
	}

	if req.primaryLockSession != nil {
		logger.Info("Rolling back switchover: releasing primary read lock")
		session := req.primaryLockSession
		// Clear it before attempting Unlock, not after: whether or not the call succeeds, the
		// session is spent and must not be retried against — e.g. changePrimaryToReplica already
		// tried and failed to unlock this same session, that's why we're here.
		req.primaryLockSession = nil
		if err := session.Unlock(ctx); err != nil {
			return fmt.Errorf("error unlocking primary: %v", err)
		}
	}

	if !restoreWriteAccess {
		return nil
	}

	client, err := req.replClientSet.currentPrimaryClient(ctx)
	if err != nil {
		return fmt.Errorf("error getting current primary client: %v", err)
	}
	logger.Info("Rolling back switchover: restoring primary write access")
	if err := client.DisableReadOnly(ctx); err != nil {
		return fmt.Errorf("error disabling readonly in primary: %v", err)
	}
	return nil
}

// waitSyncTimedOut returns the elapsed time since the "Wait sync" phase first started failing in
// the current switchover attempt, and whether it exceeds replication.Primary.SwitchoverTimeout.
// The start time is derived from the ConditionTypeReplicationSyncing condition, which is only set
// to False once, on the first Wait sync failure, and stays False across retries until Wait sync
// succeeds or the switchover is aborted/reset (meta.SetStatusCondition only moves LastTransitionTime
// when Status actually changes). This bounds cumulative Wait sync retry time only, not the other
// switchover phases, which are bounded individually by otherPhaseTimeout instead.
func (r *ReplicationReconciler) waitSyncTimedOut(mdb *mariadbv1alpha1.MariaDB,
	replication mariadbv1alpha1.Replication) (time.Duration, bool) {
	cond := meta.FindStatusCondition(mdb.Status.Conditions, mariadbv1alpha1.ConditionTypeReplicationSyncing)
	if cond == nil || cond.Status != metav1.ConditionFalse {
		return 0, false
	}
	timeout := ptr.Deref(replication.Primary.SwitchoverTimeout, metav1.Duration{Duration: 60 * time.Second}).Duration
	if timeout <= 0 {
		return 0, false
	}
	elapsed := time.Since(cond.LastTransitionTime.Time)
	return elapsed, elapsed > timeout
}

// handleWaitSyncFailure is called whenever the "Wait sync" phase fails. It records the failure via
// ConditionTypeReplicationSyncing (a no-op on retries after the first), rolls back the primary's
// read lock/read-only state (see rollbackSwitchover — "Wait sync" always runs before "Configure
// new primary" makes the new primary writable, so this is always safe here) so the cluster isn't
// stuck rejecting writes while retries wait for replicas to catch up, and, once the cumulative
// retry time exceeds replication.Primary.SwitchoverTimeout, aborts the switchover instead of
// propagating the raw error.
func (r *ReplicationReconciler) handleWaitSyncFailure(ctx context.Context, req *ReconcileRequest, logger logr.Logger,
	replication mariadbv1alpha1.Replication, waitSyncErr error) error {
	if err := r.patchStatus(ctx, req.mariadb, func(status *mariadbv1alpha1.MariaDBStatus) {
		condition.SetReplicationSyncing(&req.mariadb.Status)
	}); err != nil {
		return fmt.Errorf("error patching MariaDB status: %v", err)
	}
	if rollbackErr := r.rollbackSwitchover(ctx, req, logger, true); rollbackErr != nil {
		logger.Error(rollbackErr, "error rolling back switchover after failed phase", "phase", waitSyncPhaseName)
	}
	if elapsed, timedOut := r.waitSyncTimedOut(req.mariadb, replication); timedOut {
		return r.abortSwitchover(ctx, req, logger, elapsed)
	}
	return fmt.Errorf("error in %s switchover reconcile phase: %v", waitSyncPhaseName, waitSyncErr)
}

// abortSwitchover gives up an in-progress switchover/failover that has exceeded its timeout.
// It restores the primary to a writable state (best-effort: handleWaitSyncFailure's rollbackSwitchover
// call above already does this via the session-scoped lock, so UnlockTables here is normally a no-op)
// and reverts the desired primary back to the current one, so that IsReplicationSwitchoverRequired()
// stops triggering retries.
func (r *ReplicationReconciler) abortSwitchover(ctx context.Context, req *ReconcileRequest, logger logr.Logger,
	elapsed time.Duration) error {
	logger.Info("Switchover timed out, aborting", "elapsed", elapsed)

	if req.currentPrimaryReady {
		client, err := req.replClientSet.currentPrimaryClient(ctx)
		if err != nil {
			return fmt.Errorf("error getting current primary client: %v", err)
		}
		if err := client.UnlockTables(ctx); err != nil {
			return fmt.Errorf("error unlocking primary: %v", err)
		}
		if err := client.DisableReadOnly(ctx); err != nil {
			return fmt.Errorf("error disabling readonly in primary: %v", err)
		}
	}

	if err := r.patch(ctx, req.mariadb, func(mdb *mariadbv1alpha1.MariaDB) {
		// Copy the value rather than aliasing the pointer: Spec and Status must not share the same *int.
		mdb.Spec.Replication.Primary.PodIndex = ptr.To(*mdb.Status.CurrentPrimaryPodIndex)
	}); err != nil {
		return fmt.Errorf("error reverting desired primary: %v", err)
	}

	if err := r.patchStatus(ctx, req.mariadb, func(status *mariadbv1alpha1.MariaDBStatus) {
		condition.SetPrimarySwitchoverTimeout(&req.mariadb.Status, elapsed.String())
		condition.SetReplicationSynced(&req.mariadb.Status)
	}); err != nil {
		return fmt.Errorf("error patching MariaDB status: %v", err)
	}

	logger.Info("Switchover aborted")
	r.recorder.Eventf(req.mariadb, nil, corev1.EventTypeWarning, mariadbv1alpha1.ReasonReplicationSwitchoverTimeout,
		mariadbv1alpha1.ActionReconciling, "Switchover timed out after %s, reverted to primary at index '%d'",
		elapsed, *req.mariadb.Status.CurrentPrimaryPodIndex)
	return nil
}

func (r *ReplicationReconciler) reconcileStaleSwitchover(ctx context.Context, req *ReconcileRequest,
	logger logr.Logger) error {
	if !isSwitchoverStale(req.mariadb) {
		return nil
	}
	if !req.currentPrimaryReady {
		logger.Info("Skipped stale switchover reconciliation due to primary's non ready status")
		return nil
	}
	currentPrimaryClient, err := req.replClientSet.currentPrimaryClient(ctx)
	if err != nil {
		return fmt.Errorf("error getting current primary client: %v", err)
	}

	logger.Info("Unlocking primary")
	if err := currentPrimaryClient.UnlockTables(ctx); err != nil {
		return fmt.Errorf("error unlocking primary: %v", err)
	}

	logger.Info("Disabling readonly in primary")
	if err := currentPrimaryClient.DisableReadOnly(ctx); err != nil {
		return fmt.Errorf("error disabling readonly in primary: %v", err)
	}

	if err := r.patchStatus(ctx, req.mariadb, func(status *mariadbv1alpha1.MariaDBStatus) {
		condition.SetPrimarySwitched(&req.mariadb.Status)
		condition.SetReplicationSynced(&req.mariadb.Status)
	}); err != nil {
		return fmt.Errorf("error patching MariaDB status: %v", err)
	}

	logger.Info("Stale switchover has been reset")
	r.recorder.Eventf(req.mariadb, nil, corev1.EventTypeNormal, mariadbv1alpha1.ReasonReplicationResetStaleSwitchover,
		mariadbv1alpha1.ActionReconciling, "Stale switchover has been reset")
	return nil
}

func (r *ReplicationReconciler) lockPrimaryWithReadLock(ctx context.Context, req *ReconcileRequest, logger logr.Logger) error {
	if !req.currentPrimaryReady {
		logger.Info("Skipped locking primary with read lock due to primary's non ready status")
		return nil
	}
	client, err := req.replClientSet.currentPrimaryClient(ctx)
	if err != nil {
		return fmt.Errorf("error getting current primary client: %v", err)
	}

	logger.Info("Locking primary with read lock")
	r.recorder.Eventf(req.mariadb, nil, corev1.EventTypeNormal, mariadbv1alpha1.ReasonReplicationPrimaryLock,
		mariadbv1alpha1.ActionReconciling, "Locking primary with read lock")
	session, err := client.LockTablesWithReadLock(ctx)
	if err != nil {
		return err
	}
	req.primaryLockSession = session
	return nil
}

func (r *ReplicationReconciler) setPrimaryReadOnly(ctx context.Context, req *ReconcileRequest, logger logr.Logger) error {
	if !req.currentPrimaryReady {
		logger.Info("Skipped enabling readonly mode in primary due to primary's non ready status")
		return nil
	}
	client, err := req.replClientSet.currentPrimaryClient(ctx)
	if err != nil {
		return fmt.Errorf("error getting current primary client: %v", err)
	}

	logger.Info("Enabling readonly mode in primary")
	r.recorder.Eventf(req.mariadb, nil, corev1.EventTypeNormal, mariadbv1alpha1.ReasonReplicationPrimaryReadonly,
		mariadbv1alpha1.ActionReconciling, "Enabling readonly mode in primary")
	return client.EnableReadOnly(ctx)
}

func (r *ReplicationReconciler) waitSync(ctx context.Context, req *ReconcileRequest, logger logr.Logger) error {
	if req.currentPrimaryReady {
		return r.waitForReplicaSync(ctx, req, logger)
	}
	return r.waitForNewPrimarySync(ctx, req, logger)
}

func (r *ReplicationReconciler) waitForReplicaSync(ctx context.Context, req *ReconcileRequest, logger logr.Logger) error {
	if req.mariadb.Status.CurrentPrimaryPodIndex == nil {
		return errors.New("'status.currentPrimaryPodIndex' must be set")
	}

	primaryClient, err := req.replClientSet.currentPrimaryClient(ctx)
	if err != nil {
		return fmt.Errorf("error getting current primary client: %v", err)
	}
	primaryGtid, err := primaryClient.GtidBinlogPos(ctx)
	if err != nil {
		return fmt.Errorf("error getting primary GTID binlog pos: %v", err)
	}
	if primaryGtid == "" {
		return errors.New("primary GTID (gtid_binlog_pos) is empty")
	}

	logger.Info("Waiting for replicas to be synced with primary", "gtid", primaryGtid)
	r.recorder.Eventf(req.mariadb, nil, corev1.EventTypeNormal, mariadbv1alpha1.ReasonReplicationReplicaSync,
		mariadbv1alpha1.ActionReconciling, "Waiting for replicas to be synced with primary")
	replication := ptr.Deref(req.mariadb.Spec.Replication, mariadbv1alpha1.Replication{})

	g := new(errgroup.Group)
	g.SetLimit(int(req.mariadb.Spec.Replicas))

	for i := 0; i < int(req.mariadb.Spec.Replicas); i++ {
		if i == *req.mariadb.Status.CurrentPrimaryPodIndex {
			continue
		}
		g.Go(func() error {
			replClient, err := req.replClientSet.clientForIndex(ctx, i)
			if err != nil {
				return fmt.Errorf("error getting replica '%d' client: %v", i, err)
			}
			logger.V(1).Info("Syncing replica with primary GTID", "replica", i, "gtid", primaryGtid)
			syncTimeout := ptr.Deref(replication.Replica.SyncTimeout, metav1.Duration{Duration: 10 * time.Second}).Duration

			if err := replClient.WaitForReplicaGtid(ctx, primaryGtid, syncTimeout); err != nil {
				logger.Error(err, "Error waiting for GTID in replica", "gtid", primaryGtid, "replica", i)
				r.recorder.Eventf(req.mariadb, nil, corev1.EventTypeWarning, mariadbv1alpha1.ReasonReplicationReplicaSyncErr,
					mariadbv1alpha1.ActionReconciling, "Error waiting for GTID '%s' in replica '%d': %v", primaryGtid, i, err)
				return err
			}

			logger.V(1).Info("Replica synced", "replica", i, "gtid", primaryGtid)
			return nil
		})
	}

	if err := g.Wait(); err != nil {
		return fmt.Errorf("error waiting for replica sync: %w", err)
	}

	req.replicasSynced = true
	return nil
}

func (r *ReplicationReconciler) waitForNewPrimarySync(ctx context.Context, req *ReconcileRequest, logger logr.Logger) error {
	replication := ptr.Deref(req.mariadb.Spec.Replication, mariadbv1alpha1.Replication{})
	newPrimaryClient, err := req.replClientSet.newPrimaryClient(ctx)
	if err != nil {
		return fmt.Errorf("error getting new primary client: %v", err)
	}

	logger.Info("Waiting for new primary to be synced")
	r.recorder.Eventf(req.mariadb, nil, corev1.EventTypeNormal, mariadbv1alpha1.ReasonReplicationPrimaryNewSync,
		mariadbv1alpha1.ActionReconciling, "Waiting for new primary to be synced")

	syncTimeout := ptr.Deref(replication.Replica.SyncTimeout, metav1.Duration{Duration: 10 * time.Second}).Duration
	syncCtx, cancel := context.WithTimeout(ctx, syncTimeout)
	defer cancel()

	if err := wait.PollUntilSuccessOrContextCancel(syncCtx, logger, func(ctx context.Context) error {
		status, err := newPrimaryClient.ReplicaStatus(ctx, logger, sql.WithConnectionName(mdbreplic.ReplicaConnectionName))
		if err != nil {
			if sql.IsConnectionNotExists(err) {
				return errors.New("replication channel not configured yet on new primary")
			}
			return fmt.Errorf("error getting new primary status: %v", err)
		}
		gtidDomainId, err := newPrimaryClient.GtidDomainId(ctx)
		if err != nil {
			return fmt.Errorf("error getting GTID domain ID in new primary: %v", err)
		}
		hasRelayLogEvents, err := HasRelayLogEvents(status, *gtidDomainId, logger)
		if err != nil {
			return fmt.Errorf("error checking relay logs: %v", err)
		}
		if hasRelayLogEvents {
			return errors.New("relay log events detected")
		}
		return nil
	}); err != nil {
		logger.Error(err, "Error waiting for new primary to be synced")
		r.recorder.Eventf(req.mariadb, nil, corev1.EventTypeWarning, mariadbv1alpha1.ReasonReplicationPrimaryNewSyncErr,
			mariadbv1alpha1.ActionReconciling, "Error waiting for new primary to be synced: %v", err)
		return err
	}

	logger.V(1).Info("New primary synced")
	return nil
}

func (r *ReplicationReconciler) configureNewPrimary(ctx context.Context, req *ReconcileRequest, logger logr.Logger) error {
	newPrimary := *ptr.Deref(req.mariadb.Spec.Replication, mariadbv1alpha1.Replication{}).Primary.PodIndex
	newPrimaryClient, err := req.replClientSet.newPrimaryClient(ctx)
	if err != nil {
		return fmt.Errorf("error getting new primary client: %v", err)
	}

	r.recorder.Eventf(req.mariadb, nil, corev1.EventTypeNormal, mariadbv1alpha1.ReasonReplicationPrimaryNew,
		mariadbv1alpha1.ActionReconciling, "Configuring new primary at index '%d'", newPrimary)

	topology := r.topologyManager.TopologyForMariaDB(req.mariadb, logger)

	if err := topology.ConfigurePrimary(ctx, newPrimaryClient); err != nil {
		return fmt.Errorf("error configuring new primary vars: %v", err)
	}
	return nil
}

func (r *ReplicationReconciler) connectReplicasToNewPrimary(ctx context.Context, req *ReconcileRequest, logger logr.Logger) error {
	if req.mariadb.Status.CurrentPrimaryPodIndex == nil {
		return errors.New("'status.currentPrimaryPodIndex' must be set")
	}

	newPrimary := *ptr.Deref(req.mariadb.Spec.Replication, mariadbv1alpha1.Replication{}).Primary.PodIndex
	newPrimaryClient, err := req.replClientSet.newPrimaryClient(ctx)
	if err != nil {
		return fmt.Errorf("error getting new primary client: %v", err)
	}

	logger.Info("Connecting replicas to new primary")
	r.recorder.Eventf(req.mariadb, nil, corev1.EventTypeNormal, mariadbv1alpha1.ReasonReplicationReplicaConn,
		mariadbv1alpha1.ActionReconciling, "Connecting replicas to new primary at '%d'", newPrimary)

	replicaOpts, err := r.configureReplicaOpts(ctx, req, newPrimaryClient, logger)
	if err != nil {
		return fmt.Errorf("error getting replica options: %v", err)
	}

	g := new(errgroup.Group)
	g.SetLimit(int(req.mariadb.Spec.Replicas))

	for i := 0; i < int(req.mariadb.Spec.Replicas); i++ {
		if i == *req.mariadb.Status.CurrentPrimaryPodIndex || i == newPrimary {
			continue
		}
		g.Go(func() error {
			key := types.NamespacedName{
				Name:      statefulset.PodName(req.mariadb.ObjectMeta, i),
				Namespace: req.mariadb.Namespace,
			}
			var pod corev1.Pod
			if err := r.Get(ctx, key, &pod); err != nil {
				if apierrors.IsNotFound(err) {
					logger.V(1).Info("Pod not found when connecting replicas to new primary, skipping", "pod", key.Name)
					return nil
				}
				return fmt.Errorf("error getting pod '%s': %w", key.Name, err)
			}
			if !mariadbpod.PodReady(&pod) {
				logger.V(1).Info("Skipping non ready Pod when connecting replicas to new primary", "pod", key.Name)
				return nil
			}

			replClient, err := req.replClientSet.clientForIndex(ctx, i)
			if err != nil {
				return fmt.Errorf("error getting replica '%d' client: %v", i, err)
			}
			topology := r.topologyManager.TopologyForMariaDB(req.mariadb, logger.WithValues("replica", i))

			if err := topology.ConfigureReplica(ctx, replClient, newPrimary, replicaOpts...); err != nil {
				return fmt.Errorf("error configuring replica '%d': %v", i, err)
			}

			return nil
		})
	}

	return g.Wait()
}

func (r *ReplicationReconciler) changePrimaryToReplica(ctx context.Context, req *ReconcileRequest, logger logr.Logger) error {
	if req.mariadb.Status.CurrentPrimaryPodIndex == nil {
		return errors.New("'status.currentPrimaryPodIndex' must be set")
	}
	if !req.currentPrimaryReady {
		logger.Info("Skipped changing primary to be a replica due to primary's non ready status")
		return nil
	}

	currentPrimary := *req.mariadb.Status.CurrentPrimaryPodIndex
	currentPrimaryClient, err := req.replClientSet.currentPrimaryClient(ctx)
	if err != nil {
		return fmt.Errorf("error getting current primary client: %v", err)
	}
	newPrimary := *ptr.Deref(req.mariadb.Spec.Replication, mariadbv1alpha1.Replication{}).Primary.PodIndex
	newPrimaryClient, err := req.replClientSet.newPrimaryClient(ctx)
	if err != nil {
		return fmt.Errorf("error getting new primary client: %v", err)
	}

	logger.Info("Change primary to be a replica")
	r.recorder.Eventf(
		req.mariadb,
		nil,
		corev1.EventTypeNormal,
		mariadbv1alpha1.ReasonReplicationPrimaryToReplica,
		mariadbv1alpha1.ActionReconciling,
		"Unlocking primary '%d' and configuring it to be a replica. New primary at '%d'",
		currentPrimary,
		newPrimary,
	)

	replicaOpts, err := r.configureReplicaOpts(ctx, req, newPrimaryClient, logger)
	if err != nil {
		return fmt.Errorf("error getting replica options: %v", err)
	}

	logger.Info("Unlocking primary")
	r.recorder.Eventf(req.mariadb, nil, corev1.EventTypeNormal, mariadbv1alpha1.ReasonReplicationPrimaryLock,
		mariadbv1alpha1.ActionReconciling, "Unlocking primary")
	if req.primaryLockSession != nil {
		session := req.primaryLockSession
		// Clear it before attempting Unlock, not after: whether or not the call succeeds, the
		// session is spent. Leaving it set on failure would make rollbackSwitchover retry Unlock
		// against the same (likely already broken) connection, producing a second, more
		// confusing error instead of the original one.
		req.primaryLockSession = nil
		if err := session.Unlock(ctx); err != nil {
			return fmt.Errorf("error unlocking primary: %v", err)
		}
	} else {
		// Resuming a switchover whose lock phase ran in a previous, failed reconcile: the
		// dedicated session isn't available across reconciles, so fall back to a best-effort
		// unlock through a fresh pooled connection, same as reconcileStaleSwitchover's recovery
		// path. If the original session's connection died, MariaDB already released the
		// session-scoped read lock when that connection closed, so this is most likely a no-op.
		if err := currentPrimaryClient.UnlockTables(ctx); err != nil {
			logger.Error(err, "Error unlocking primary through a fresh connection; "+
				"the read lock was most likely already released when the original session closed")
		}
	}

	topology := r.topologyManager.TopologyForMariaDB(req.mariadb, logger)

	return topology.ConfigureReplica(
		ctx,
		currentPrimaryClient,
		newPrimary,
		replicaOpts...,
	)
}

func (r *ReplicationReconciler) configureReplicaOpts(ctx context.Context, req *ReconcileRequest, primaryClient *sql.Client,
	logger logr.Logger) ([]ConfigureReplicaOpt, error) {
	var replicaOpts []ConfigureReplicaOpt

	if req.replicasSynced {
		primaryBinlogPos, err := primaryClient.GtidBinlogPos(ctx)
		if err != nil {
			return nil, fmt.Errorf("error getting primary binlog position: %v", err)
		}
		logger.Info("Configuring replicas with primary GTID", "gtid", primaryBinlogPos)
		replicaOpts = append(replicaOpts, WithGtidSlavePos(primaryBinlogPos))
	} else {
		replicaOpts = append(replicaOpts, WithResetGtidSlavePos())
	}

	// avoid deleting binary logs during archival to prevent drifting from object storage
	if req.mariadb.IsPointInTimeRecoveryEnabled() {
		replicaOpts = append(replicaOpts, WithResetMaster(false))
	}
	return replicaOpts, nil
}

func (r *ReplicationReconciler) currentPrimaryReady(ctx context.Context, mariadb *mariadbv1alpha1.MariaDB,
	clientSet *ReplicationClientSet) (bool, error) {
	if mariadb.Status.CurrentPrimaryPodIndex == nil {
		return false, errors.New("'status.currentPrimaryPodIndex' must be set")
	}
	_, err := clientSet.clientForIndex(ctx, *mariadb.Status.CurrentPrimaryPodIndex, sql.WithTimeout(1*time.Second))
	return err == nil, nil
}
