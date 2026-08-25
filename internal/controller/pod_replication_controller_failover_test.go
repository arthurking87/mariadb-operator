package controller

import (
	"context"
	"testing"
	"time"

	"github.com/mariadb-operator/mariadb-operator/v26/pkg/metadata"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/refresolver"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/statefulset"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/events"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

// This file is a regression test for issue #79's outer layer. ReconcilePodNotReady's own
// handling of replication.ErrNoFailoverCandidate (propagating it rather than swallowing it) is
// covered by pod_replication_controller_sentinel_test.go; this file covers what
// PodController.Reconcile does with that propagated error — it used to be swallowed entirely
// (return nil), which meant PodController.Reconcile returned ctrl.Result{} with no requeue at
// all, and since its watch predicate (podHasChanged) only fires on a Pod readiness transition,
// nothing would ever re-trigger this reconcile once the primary Pod's readiness stopped
// changing: failover would get stuck monitoring forever instead of retrying once a replica
// recovers.

// TestPodController_NoCandidateRequeuesAtFixedInterval covers the outer layer: PodController.Reconcile
// must translate replication.ErrNoFailoverCandidate into a bounded RequeueAfter, not the generic
// ctrl.Result{Requeue: true} (default rate-limited backoff, meant for transient errors) and not a
// no-requeue success result (the original bug).
func TestPodController_NoCandidateRequeuesAtFixedInterval(t *testing.T) {
	mdb := newFakeReplMariaDB("test-mariadb", 3, 0)
	// Pre-set to a past time so ReconcilePodNotReady's first-failure bookkeeping (a status
	// patch) is a no-op, same as newSentinelTestMariaDB in pod_replication_controller_sentinel_test.go
	// — this test is about what happens after that point, not the patch machinery itself.
	past := metav1.NewTime(time.Now().Add(-time.Minute))
	mdb.Status.CurrentPrimaryFailingSince = &past
	primaryPodName := statefulset.PodName(mdb.ObjectMeta, 0)
	primaryPod := newFakeReplPod(mdb, 0, "10.0.0.1", false)
	primaryPod.Annotations = map[string]string{metadata.MariadbAnnotation: mdb.Name}

	scheme := newFakeReplicationScheme(t)
	fakeClient := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(mdb, primaryPod).
		Build()

	podReplicationController := NewPodReplicationController(fakeClient, events.NewFakeRecorder(10), nil)

	podController := NewPodController(
		"pod-controller-test",
		fakeClient,
		refresolver.New(fakeClient),
		podReplicationController,
		nil,
	)

	result, err := podController.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: client.ObjectKey{Name: primaryPodName, Namespace: mdb.Namespace},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Compare the whole struct rather than reading result.Requeue directly (deprecated in favor
	// of RequeueAfter): this still asserts the generic default-backoff path (Requeue: true,
	// RequeueAfter: 0) was NOT taken, without triggering that deprecation.
	want := ctrl.Result{RequeueAfter: noFailoverCandidateRequeueInterval}
	if result != want {
		t.Errorf("expected result = %+v, got %+v", want, result)
	}
}
