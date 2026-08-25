package replication

import (
	"context"
	"testing"

	"github.com/go-logr/logr"
	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	sqlClient "github.com/mariadb-operator/mariadb-operator/v26/pkg/sql"
)

// replClientSetErroringOnCurrentPrimary returns a *ReplicationClientSet whose
// currentPrimaryClient() call always fails (status.currentPrimaryPodIndex is left unset).
// Using this as req.replClientSet lets a test prove a code path never attempts to reach the
// current primary: if it did, the resulting error would surface and the test would fail,
// instead of a split-brain regression passing silently.
func replClientSetErroringOnCurrentPrimary() *ReplicationClientSet {
	return &ReplicationClientSet{
		ClientSet: sqlClient.NewClientSet(&mariadbv1alpha1.MariaDB{}, nil),
	}
}

// TestRollbackSwitchover_NoSplitBrain covers the fix for the PR #87 split-brain risk: once a
// switchover phase has run with rollbackOnFailure == false (i.e. after "Configure new primary"
// succeeded and the new primary may already be writable), rollbackSwitchover must NOT restore
// the old primary's write access, or both primaries could end up writable at once.
//
// req.replClientSet is deliberately wired to error out if currentPrimaryClient() is ever
// called, so that a regression (restoring write access unconditionally) turns into a hard
// test failure instead of a silently reintroduced split-brain window.
func TestRollbackSwitchover_NoSplitBrain(t *testing.T) {
	req := &ReconcileRequest{
		mariadb:             &mariadbv1alpha1.MariaDB{},
		currentPrimaryReady: true,
		primaryLockSession:  nil, // already released by an earlier phase, e.g. changePrimaryToReplica
		replClientSet:       replClientSetErroringOnCurrentPrimary(),
	}

	r := &ReplicationReconciler{}
	err := r.rollbackSwitchover(context.Background(), req, logr.Discard(), false /* restoreWriteAccess */)
	if err != nil {
		t.Fatalf("expected no error, got: %v (write access should never have been attempted once the new "+
			"primary was configured)", err)
	}
}

// TestRollbackSwitchover_RestoresWriteAccessWhenAllowed is the mirror-image sanity check: when
// rollbackOnFailure is true (the failure happened before the new primary was ever made
// writable), rollbackSwitchover must still attempt to restore the old primary's write access.
// It's expected to fail here, since req.replClientSet can't reach a real primary — the point is
// to confirm the code path is actually taken (the error is the "error getting current primary
// client" wrapper), proving restoreWriteAccess=true isn't silently skipped like the false case.
func TestRollbackSwitchover_RestoresWriteAccessWhenAllowed(t *testing.T) {
	req := &ReconcileRequest{
		mariadb:             &mariadbv1alpha1.MariaDB{},
		currentPrimaryReady: true,
		primaryLockSession:  nil,
		replClientSet:       replClientSetErroringOnCurrentPrimary(),
	}

	r := &ReplicationReconciler{}
	err := r.rollbackSwitchover(context.Background(), req, logr.Discard(), true /* restoreWriteAccess */)
	if err == nil {
		t.Fatal("expected an error attempting to reach the current primary client, got nil " +
			"(restoreWriteAccess=true should still attempt to restore write access)")
	}
}

// TestRollbackSwitchover_ClearsSessionBeforeAttemptingUnlock covers the double-unlock-on-dead-
// session fix from PR #87: rollbackSwitchover must clear req.primaryLockSession BEFORE calling
// Unlock on it, not after, so that if Unlock fails (the connection died, e.g. because the
// primary Pod was replaced mid-switchover), a later rollback attempt does not retry Unlock
// against that same broken session again.
//
// A zero-value *sql.LockedSession (nil underlying connection) is used to force Unlock to fail
// deterministically without needing a live database connection -- sql.LockedSession's internals
// are unexported, so this is the only way to get a non-nil *sql.LockedSession value from outside
// pkg/sql. This state never occurs in real usage (LockTablesWithReadLock always returns either a
// valid session or an error), so Unlock panics on the nil connection rather than returning a
// clean error; the panic is recovered here purely to observe rollbackSwitchover's field-clearing
// order. (The clean, non-panicking "Unlock fails on an already-dead connection" case is covered
// end-to-end against a fake driver in pkg/sql's TestLockedSession_UnlockOnDeadConnection.)
func TestRollbackSwitchover_ClearsSessionBeforeAttemptingUnlock(t *testing.T) {
	deadSession := new(sqlClient.LockedSession)
	req := &ReconcileRequest{
		mariadb:             &mariadbv1alpha1.MariaDB{},
		currentPrimaryReady: true,
		primaryLockSession:  deadSession,
		replClientSet:       replClientSetErroringOnCurrentPrimary(),
	}
	r := &ReplicationReconciler{}

	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("expected Unlock on the zero-value session to panic (nil underlying connection); " +
					"if this stops panicking, replace this test with a plain error-return assertion")
			}
		}()
		_ = r.rollbackSwitchover(context.Background(), req, logr.Discard(), false)
	}()

	if req.primaryLockSession != nil {
		t.Fatal("expected primaryLockSession to be cleared before attempting Unlock, even though Unlock " +
			"failed -- otherwise a retried rollback would hit the same dead session again")
	}

	// Second attempt (e.g. triggered by another failed phase in the same reconcile): must be a
	// no-op now that primaryLockSession is nil, not another attempt against the dead session.
	err := r.rollbackSwitchover(context.Background(), req, logr.Discard(), false)
	if err != nil {
		t.Errorf("expected the second rollback attempt to be a no-op, got error: %v", err)
	}
}

// TestRollbackSwitchover_NoopWhenPrimaryNotReady ensures rollbackSwitchover doesn't touch the
// lock session or attempt to restore write access at all when the current primary isn't ready
// -- there's nothing safe to do against a primary we can't reach.
func TestRollbackSwitchover_NoopWhenPrimaryNotReady(t *testing.T) {
	session := new(sqlClient.LockedSession)
	req := &ReconcileRequest{
		mariadb:             &mariadbv1alpha1.MariaDB{},
		currentPrimaryReady: false,
		primaryLockSession:  session,
		replClientSet:       replClientSetErroringOnCurrentPrimary(),
	}
	r := &ReplicationReconciler{}

	err := r.rollbackSwitchover(context.Background(), req, logr.Discard(), true /* restoreWriteAccess */)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if req.primaryLockSession == nil {
		t.Error("expected primaryLockSession to be left untouched when the primary isn't ready")
	}
}
