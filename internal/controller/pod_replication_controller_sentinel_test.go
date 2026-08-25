package controller

import (
	"context"
	"errors"
	"testing"
	"time"

	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/controller/replication"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

// This file tests ReconcilePodNotReady's handling of the two kinds of errors that can come
// back from FurthestAdvancedReplica:
//   - replication.ErrNoFailoverCandidate: expected when no replica is currently healthy
//     enough to promote. Logged and turned into a Warning Event either way, but propagated as
//     an error rather than swallowed: PodController.Reconcile (see pod_controller.go) turns
//     this specific sentinel into a bounded RequeueAfter, so failover keeps getting retried.
//     Returning nil here would make PodController.Reconcile return ctrl.Result{} with no
//     requeue at all, and since its watch predicate only fires on a Pod readiness transition,
//     nothing would ever re-trigger this reconcile once the primary Pod's readiness stops
//     changing — failover would get stuck monitoring forever (see issue #79).
//   - any other error (e.g. a transient failure listing secondary Pods): must be propagated
//     unchanged so the caller requeues-with-backoff and retries.
//
// It intentionally does not go through the package's Ginkgo/envtest suite (see suite_test.go):
// ReconcilePodNotReady only needs a client.Client and an events.EventRecorder, both of which
// are trivially fakeable, so a real API server is unnecessary for this behavior. Target these
// tests specifically with:
//   go test ./internal/controller/... -run TestReconcilePodNotReady -v

// recordedEvent captures a single call to sentinelEventRecorder.Eventf.
type recordedEvent struct {
	eventtype string
	reason    string
	action    string
	note      string
}

// sentinelEventRecorder is a minimal events.EventRecorder that records Eventf calls instead of
// emitting real Kubernetes Events.
type sentinelEventRecorder struct {
	events []recordedEvent
}

func (f *sentinelEventRecorder) Eventf(regarding, related runtime.Object, eventtype, reason, action, note string, args ...interface{}) {
	f.events = append(f.events, recordedEvent{
		eventtype: eventtype,
		reason:    reason,
		action:    action,
		note:      note,
	})
}

// listErrorClient wraps a client.Client and forces every List call to fail with the
// configured error, simulating a transient failure while listing secondary Pods.
type listErrorClient struct {
	client.Client
	err error
}

func (c *listErrorClient) List(ctx context.Context, list client.ObjectList, opts ...client.ListOption) error {
	return c.err
}

func newSentinelTestScheme(t *testing.T) *runtime.Scheme {
	t.Helper()
	scheme := runtime.NewScheme()
	if err := corev1.AddToScheme(scheme); err != nil {
		t.Fatalf("error adding corev1 to scheme: %v", err)
	}
	if err := mariadbv1alpha1.AddToScheme(scheme); err != nil {
		t.Fatalf("error adding mariadbv1alpha1 to scheme: %v", err)
	}
	return scheme
}

// newSentinelTestMariaDB builds a minimal MariaDB with replication enabled, auto-failover
// enabled with no delay, a configured replica, and primary index 0 already failing since
// the past. This is deliberately set up so that ReconcilePodNotReady's earlier branches
// (shouldReconcile, autoFailoverDelay, CurrentPrimaryFailingSince bookkeeping) are all
// no-ops, and execution reaches the FurthestAdvancedReplica error-handling branch under
// test without requiring the MariaDB object to be pre-loaded into (and patchable via) the
// fake client.
func newSentinelTestMariaDB(namespace string) *mariadbv1alpha1.MariaDB {
	past := metav1.NewTime(metav1.Now().Add(-time.Minute))
	return &mariadbv1alpha1.MariaDB{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "mariadb-test",
			Namespace: namespace,
		},
		Spec: mariadbv1alpha1.MariaDBSpec{
			Replication: &mariadbv1alpha1.Replication{
				Enabled: true,
				ReplicationSpec: mariadbv1alpha1.ReplicationSpec{
					Primary: mariadbv1alpha1.PrimaryReplication{
						PodIndex:     ptr.To(0),
						AutoFailover: ptr.To(true),
					},
				},
			},
		},
		Status: mariadbv1alpha1.MariaDBStatus{
			CurrentPrimaryPodIndex:     ptr.To(0),
			CurrentPrimaryFailingSince: &past,
			Replication: &mariadbv1alpha1.ReplicationStatus{
				Roles: map[string]mariadbv1alpha1.ReplicationRole{
					"mariadb-test-1": mariadbv1alpha1.ReplicationRoleReplica,
				},
			},
		},
	}
}

func newSentinelTestPrimaryPod(namespace string) corev1.Pod {
	return corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "mariadb-test-0",
			Namespace: namespace,
		},
	}
}

// TestReconcilePodNotReady_NoFailoverCandidatePropagatesSentinel proves that when
// FurthestAdvancedReplica returns replication.ErrNoFailoverCandidate (no secondary Pods to
// promote), ReconcilePodNotReady still emits a Warning Event with reason
// ReasonNoFailoverCandidate, but now returns that sentinel error rather than swallowing it (see
// the file-level comment for why swallowing it was a bug). errors.Is must hold so
// PodController.Reconcile can single it out for its own bounded-requeue handling instead of the
// generic requeue-with-backoff path.
func TestReconcilePodNotReady_NoFailoverCandidatePropagatesSentinel(t *testing.T) {
	scheme := newSentinelTestScheme(t)
	c := fake.NewClientBuilder().WithScheme(scheme).Build()
	recorder := &sentinelEventRecorder{}
	ctrl := NewPodReplicationController(c, recorder, nil)

	mdb := newSentinelTestMariaDB("test-ns")
	pod := newSentinelTestPrimaryPod("test-ns")

	err := ctrl.ReconcilePodNotReady(context.Background(), pod, mdb)
	if err == nil {
		t.Fatal("expected ReconcilePodNotReady to propagate an error when no failover candidate exists, got nil")
	}
	if !errors.Is(err, replication.ErrNoFailoverCandidate) {
		t.Errorf("expected errors.Is(err, replication.ErrNoFailoverCandidate) to hold, got: %v", err)
	}

	if len(recorder.events) != 1 {
		t.Fatalf("expected exactly 1 event to be recorded, got %d: %+v", len(recorder.events), recorder.events)
	}
	got := recorder.events[0]
	if got.reason != mariadbv1alpha1.ReasonNoFailoverCandidate {
		t.Errorf("expected event reason %q, got %q", mariadbv1alpha1.ReasonNoFailoverCandidate, got.reason)
	}
	if got.eventtype != corev1.EventTypeWarning {
		t.Errorf("expected event type %q, got %q", corev1.EventTypeWarning, got.eventtype)
	}
}

// TestReconcilePodNotReady_TransientLookupErrorIsPropagated proves that a transient error
// while looking up failover candidates (e.g. the API server briefly unreachable while
// listing secondary Pods) is propagated by ReconcilePodNotReady rather than swallowed, so
// the caller requeues-with-backoff and retries. If this regressed to swallowing every error
// from FurthestAdvancedReplica the same way as the sentinel, this test would see a nil error
// and an incorrectly recorded "no candidate" Event.
func TestReconcilePodNotReady_TransientLookupErrorIsPropagated(t *testing.T) {
	scheme := newSentinelTestScheme(t)
	base := fake.NewClientBuilder().WithScheme(scheme).Build()
	injected := errors.New("connection refused")
	c := &listErrorClient{Client: base, err: injected}
	recorder := &sentinelEventRecorder{}
	ctrl := NewPodReplicationController(c, recorder, nil)

	mdb := newSentinelTestMariaDB("test-ns")
	pod := newSentinelTestPrimaryPod("test-ns")

	err := ctrl.ReconcilePodNotReady(context.Background(), pod, mdb)
	if err == nil {
		t.Fatal("expected the transient lookup error to be propagated, got nil")
	}
	if errors.Is(err, replication.ErrNoFailoverCandidate) {
		t.Fatalf("did not expect the transient error to match ErrNoFailoverCandidate, got: %v", err)
	}

	if len(recorder.events) != 0 {
		t.Fatalf("expected no 'no candidate' event to be recorded for a transient error, got %d: %+v", len(recorder.events), recorder.events)
	}
}
