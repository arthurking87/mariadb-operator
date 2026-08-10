package replication

import (
	"context"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
	"time"

	"github.com/go-logr/logr"
	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	k8sruntime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/tools/events"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

// This file covers the scoping of replication.Primary.SwitchoverTimeout after
// https://github.com/mariadb-operator/mariadb-operator/commit/8d623a58 ("remove per-phase
// timeout on non-Wait-sync switchover phases"), which removed the otherPhaseTimeout /
// switchoverPhase.timeout mechanism introduced by 6b4baefc ("scope SwitchoverTimeout to Wait
// sync retries only").
//
// After both commits combined:
//   - SwitchoverTimeout bounds ONLY the cumulative retry time of the "Wait sync" phase, via
//     waitSyncTimedOut/handleWaitSyncFailure and the ConditionTypeReplicationSyncing condition.
//   - Every other switchover phase (lock primary, set read_only, configure new primary, connect
//     replicas, change primary to replica) has NO timeout at all anymore: no per-phase bound
//     (removed by 8d623a58) and no SwitchoverTimeout-driven bound either (never had one, since
//     6b4baefc scoped SwitchoverTimeout down to Wait sync only).
//
// TestWaitSyncTimedOut_ScopedToWaitSyncPhase and TestHandleWaitSyncFailure_AbortsOnlyAfterCumulativeWaitSyncTimeout
// exercise the real production functions directly to prove (a): the Wait sync phase is correctly
// bounded by SwitchoverTimeout.
//
// TestSwitchoverPhase_HasNoPerPhaseTimeoutField and TestReconcileSwitchover_NoPerPhaseContextTimeout
// pin (b): no phase other than "Wait sync" is bounded by any timeout, structurally proving the
// otherPhaseTimeout mechanism was not reintroduced under a different name. reconcileSwitchover
// itself can't be driven end-to-end in a unit test without a real MariaDB/MySQL server (its
// non-"Wait sync" phases unconditionally dial out via pkg/sql.Client, which is a concrete struct
// with no fake/mock seam), so these two tests inspect the real switchover.go source/types instead
// of re-implementing the loop, which would only prove properties of a copy, not of the shipped code.

func newSwitchoverTestReconciler(t *testing.T, mdb *mariadbv1alpha1.MariaDB) *ReplicationReconciler {
	t.Helper()
	scheme := k8sruntime.NewScheme()
	if err := mariadbv1alpha1.AddToScheme(scheme); err != nil {
		t.Fatalf("error adding scheme: %v", err)
	}
	fakeClient := fake.NewClientBuilder().
		WithScheme(scheme).
		WithStatusSubresource(&mariadbv1alpha1.MariaDB{}).
		WithObjects(mdb).
		Build()
	return &ReplicationReconciler{
		Client:   fakeClient,
		recorder: events.NewFakeRecorder(10),
	}
}

func newSwitchoverTestMariaDB(switchoverTimeout *metav1.Duration) *mariadbv1alpha1.MariaDB {
	return &mariadbv1alpha1.MariaDB{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "mariadb-test",
			Namespace: "default",
		},
		Spec: mariadbv1alpha1.MariaDBSpec{
			Replicas: 2,
			Replication: &mariadbv1alpha1.Replication{
				Enabled: true,
				ReplicationSpec: mariadbv1alpha1.ReplicationSpec{
					Primary: mariadbv1alpha1.PrimaryReplication{
						PodIndex:          ptr.To(1),
						SwitchoverTimeout: switchoverTimeout,
					},
				},
			},
		},
		Status: mariadbv1alpha1.MariaDBStatus{
			CurrentPrimaryPodIndex: ptr.To(0),
		},
	}
}

// TestWaitSyncTimedOut_ScopedToWaitSyncPhase exercises waitSyncTimedOut directly: the sole
// function that decides whether SwitchoverTimeout has been exceeded. It proves the timeout is
// keyed exclusively off ConditionTypeReplicationSyncing (set only while the "Wait sync" phase is
// actively retrying) and NOT off how long the switchover has been running overall, which would
// also reflect time spent stuck in other phases such as "Lock primary" or "Configure new primary".
func TestWaitSyncTimedOut_ScopedToWaitSyncPhase(t *testing.T) {
	tests := []struct {
		name        string
		conditions  []metav1.Condition
		timeout     *metav1.Duration
		wantTimeout bool
	}{
		{
			name:        "no Wait sync failure recorded yet",
			conditions:  nil,
			timeout:     &metav1.Duration{Duration: 100 * time.Millisecond},
			wantTimeout: false,
		},
		{
			name: "stuck in a non-Wait-sync phase for far longer than SwitchoverTimeout: not timed out",
			// Simulates a switchover that has been stuck in e.g. "Lock primary" or "Configure new
			// primary" for 5 minutes: the overall switchover started long ago (PrimarySwitched
			// False for 5m), but Wait sync was never reached, so ReplicationSyncing was never set.
			conditions: []metav1.Condition{
				{
					Type:               mariadbv1alpha1.ConditionTypePrimarySwitched,
					Status:             metav1.ConditionFalse,
					Reason:             mariadbv1alpha1.ConditionReasonSwitchPrimary,
					LastTransitionTime: metav1.NewTime(time.Now().Add(-5 * time.Minute)),
				},
			},
			timeout:     &metav1.Duration{Duration: 100 * time.Millisecond},
			wantTimeout: false,
		},
		{
			name: "Wait sync currently synced (condition True): not timed out",
			conditions: []metav1.Condition{
				{
					Type:               mariadbv1alpha1.ConditionTypeReplicationSyncing,
					Status:             metav1.ConditionTrue,
					Reason:             mariadbv1alpha1.ConditionReasonReplicationSynced,
					LastTransitionTime: metav1.NewTime(time.Now().Add(-time.Hour)),
				},
			},
			timeout:     &metav1.Duration{Duration: 100 * time.Millisecond},
			wantTimeout: false,
		},
		{
			name: "Wait sync retrying within custom SwitchoverTimeout: not timed out",
			conditions: []metav1.Condition{
				{
					Type:               mariadbv1alpha1.ConditionTypeReplicationSyncing,
					Status:             metav1.ConditionFalse,
					Reason:             mariadbv1alpha1.ConditionReasonReplicationSyncing,
					LastTransitionTime: metav1.NewTime(time.Now().Add(-50 * time.Millisecond)),
				},
			},
			timeout:     &metav1.Duration{Duration: 200 * time.Millisecond},
			wantTimeout: false,
		},
		{
			name: "Wait sync retrying past custom SwitchoverTimeout: timed out",
			conditions: []metav1.Condition{
				{
					Type:               mariadbv1alpha1.ConditionTypeReplicationSyncing,
					Status:             metav1.ConditionFalse,
					Reason:             mariadbv1alpha1.ConditionReasonReplicationSyncing,
					LastTransitionTime: metav1.NewTime(time.Now().Add(-150 * time.Millisecond)),
				},
			},
			timeout:     &metav1.Duration{Duration: 100 * time.Millisecond},
			wantTimeout: true,
		},
		{
			name: "Wait sync retrying past default 60s SwitchoverTimeout: timed out",
			conditions: []metav1.Condition{
				{
					Type:               mariadbv1alpha1.ConditionTypeReplicationSyncing,
					Status:             metav1.ConditionFalse,
					Reason:             mariadbv1alpha1.ConditionReasonReplicationSyncing,
					LastTransitionTime: metav1.NewTime(time.Now().Add(-61 * time.Second)),
				},
			},
			timeout:     nil, // defaults to 60s
			wantTimeout: true,
		},
		{
			name: "Wait sync retrying within default 60s SwitchoverTimeout: not timed out",
			conditions: []metav1.Condition{
				{
					Type:               mariadbv1alpha1.ConditionTypeReplicationSyncing,
					Status:             metav1.ConditionFalse,
					Reason:             mariadbv1alpha1.ConditionReasonReplicationSyncing,
					LastTransitionTime: metav1.NewTime(time.Now().Add(-1 * time.Second)),
				},
			},
			timeout:     nil,
			wantTimeout: false,
		},
		{
			name: "SwitchoverTimeout <= 0 disables the abort regardless of elapsed time",
			conditions: []metav1.Condition{
				{
					Type:               mariadbv1alpha1.ConditionTypeReplicationSyncing,
					Status:             metav1.ConditionFalse,
					Reason:             mariadbv1alpha1.ConditionReasonReplicationSyncing,
					LastTransitionTime: metav1.NewTime(time.Now().Add(-time.Hour)),
				},
			},
			timeout:     &metav1.Duration{Duration: 0},
			wantTimeout: false,
		},
	}

	r := &ReplicationReconciler{}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mdb := newSwitchoverTestMariaDB(tt.timeout)
			mdb.Status.Conditions = tt.conditions
			replication := ptr.Deref(mdb.Spec.Replication, mariadbv1alpha1.Replication{})

			_, timedOut := r.waitSyncTimedOut(mdb, replication)
			if timedOut != tt.wantTimeout {
				t.Errorf("waitSyncTimedOut() timedOut = %v, want %v", timedOut, tt.wantTimeout)
			}
		})
	}
}

// TestHandleWaitSyncFailure_AbortsOnlyAfterCumulativeWaitSyncTimeout drives the real
// handleWaitSyncFailure -> waitSyncTimedOut -> abortSwitchover chain across repeated "Wait sync"
// phase failures, the way reconcileSwitchover's phase loop would across reconciles. It proves
// SwitchoverTimeout correctly aborts (unlocks/reverts the primary) once the cumulative Wait sync
// retry time is exceeded, and does not abort before that.
func TestHandleWaitSyncFailure_AbortsOnlyAfterCumulativeWaitSyncTimeout(t *testing.T) {
	// LastTransitionTime round-trips through the fake client's status Patch as a metav1.Time,
	// which (like the real Kubernetes API server) marshals to RFC3339 with only second
	// resolution. SwitchoverTimeout must comfortably exceed that ~1s truncation jitter, or the
	// very first failure could already read back as "timed out".
	const switchoverTimeout = 3 * time.Second
	mdb := newSwitchoverTestMariaDB(&metav1.Duration{Duration: switchoverTimeout})
	r := newSwitchoverTestReconciler(t, mdb)
	req := &ReconcileRequest{
		mariadb: mdb,
		// currentPrimaryReady=false makes abortSwitchover skip contacting the primary over SQL,
		// which is not reachable from this unit test (see file-level comment).
		currentPrimaryReady: false,
	}
	replication := ptr.Deref(mdb.Spec.Replication, mariadbv1alpha1.Replication{})
	waitSyncErr := errors.New("simulated: replica sync check failing")
	ctx := context.Background()
	logger := logr.Discard()

	// First failure: must not abort, cumulative Wait sync retry time is ~0.
	err := r.handleWaitSyncFailure(ctx, req, logger, replication, waitSyncErr)
	if err == nil {
		t.Fatal("expected first Wait sync failure to return a plain error, got nil (aborted too early)")
	}
	if got := ptr.Deref(mdb.Spec.Replication.Primary.PodIndex, -1); got != 1 {
		t.Fatalf("desired primary must not be reverted yet, got PodIndex=%d, want 1", got)
	}
	cond := findCondition(mdb.Status.Conditions, mariadbv1alpha1.ConditionTypeReplicationSyncing)
	if cond == nil || cond.Status != metav1.ConditionFalse {
		t.Fatalf("expected ConditionTypeReplicationSyncing=False after first failure, got %+v", cond)
	}

	// Let the cumulative Wait sync retry time exceed SwitchoverTimeout. Real sleep is used
	// because waitSyncTimedOut derives elapsed time from time.Since(cond.LastTransitionTime),
	// there is no injectable clock in this code path.
	time.Sleep(switchoverTimeout + 500*time.Millisecond)

	// Second failure: cumulative Wait sync retry time now exceeds SwitchoverTimeout, must abort.
	err = r.handleWaitSyncFailure(ctx, req, logger, replication, waitSyncErr)
	if err != nil {
		t.Fatalf("expected switchover to be aborted (nil error) once SwitchoverTimeout is exceeded, got: %v", err)
	}
	if got := ptr.Deref(mdb.Spec.Replication.Primary.PodIndex, -1); got != 0 {
		t.Fatalf("desired primary must be reverted to the current primary after abort, got PodIndex=%d, want 0", got)
	}
	switchedCond := findCondition(mdb.Status.Conditions, mariadbv1alpha1.ConditionTypePrimarySwitched)
	if switchedCond == nil || switchedCond.Reason != mariadbv1alpha1.ConditionReasonSwitchoverTimeout {
		t.Fatalf("expected ConditionTypePrimarySwitched with Reason=SwitchoverTimeout after abort, got %+v", switchedCond)
	}
}

func findCondition(conditions []metav1.Condition, condType string) *metav1.Condition {
	for i := range conditions {
		if conditions[i].Type == condType {
			return &conditions[i]
		}
	}
	return nil
}

// TestSwitchoverPhase_HasNoPerPhaseTimeoutField pins the removal of switchoverPhase.timeout (and
// therefore of the per-phase context.WithTimeout wrapping that was keyed off it) done in commit
// 8d623a58. It passes only while the type carries no such field (or any other field outside this
// allow-list, which issue #80's rollback-on-failure fix added); reintroducing a per-phase timeout
// field must come with a conscious update to this test, not sneak back in silently.
func TestSwitchoverPhase_HasNoPerPhaseTimeoutField(t *testing.T) {
	allowedFields := map[string]bool{
		"name":              true,
		"reconcile":         true,
		"afterSuccess":      true,
		"resumePoint":       true,
		"rollbackOnFailure": true,
	}
	typ := reflect.TypeOf(switchoverPhase{})
	for i := 0; i < typ.NumField(); i++ {
		name := typ.Field(i).Name
		if !allowedFields[name] {
			t.Fatalf("switchoverPhase has unexpected field %q (allowed: name, reconcile, afterSuccess, "+
				"resumePoint, rollbackOnFailure); if this is a reintroduced per-phase timeout, SwitchoverTimeout "+
				"must remain scoped to the %q phase only per issue #64's follow-up fix", name, waitSyncPhaseName)
		}
	}
}

// TestReconcileSwitchover_NoPerPhaseContextTimeout parses the real switchover.go source and
// asserts that reconcileSwitchover's body contains no context.WithTimeout call. Before commit
// 8d623a58, every phase other than "Wait sync" was wrapped in context.WithTimeout(ctx,
// otherPhaseTimeout) inside this exact loop; this test fails if that wrapping (or an equivalent
// per-phase deadline, under any name) is reintroduced for phases other than "Wait sync", which
// reconcileSwitchover cannot be driven through end-to-end in a unit test (see file-level comment)
// to prove behaviorally.
func TestReconcileSwitchover_NoPerPhaseContextTimeout(t *testing.T) {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("could not determine test file location")
	}
	srcPath := filepath.Join(filepath.Dir(thisFile), "switchover.go")

	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, srcPath, nil, 0)
	if err != nil {
		t.Fatalf("error parsing %s: %v", srcPath, err)
	}

	var fn *ast.FuncDecl
	for _, decl := range file.Decls {
		fd, ok := decl.(*ast.FuncDecl)
		if !ok || fd.Name.Name != "reconcileSwitchover" {
			continue
		}
		fn = fd
		break
	}
	if fn == nil {
		t.Fatalf("could not find func reconcileSwitchover in %s; has it been renamed?", srcPath)
	}

	var withTimeoutCalls int
	ast.Inspect(fn.Body, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		pkgIdent, ok := sel.X.(*ast.Ident)
		if !ok {
			return true
		}
		if pkgIdent.Name == "context" && sel.Sel.Name == "WithTimeout" {
			withTimeoutCalls++
		}
		return true
	})

	if withTimeoutCalls != 0 {
		t.Fatalf("reconcileSwitchover contains %d context.WithTimeout call(s); SwitchoverTimeout (and any "+
			"per-phase timeout) must only bound the %q phase via waitSyncTimedOut/handleWaitSyncFailure, "+
			"not wrap other phases in a per-attempt context deadline", withTimeoutCalls, waitSyncPhaseName)
	}
}
