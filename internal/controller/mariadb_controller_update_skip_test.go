package controller

import (
	"context"
	"testing"
	"time"

	"github.com/go-logr/logr"
	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/metadata"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/utils/ptr"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
	"sigs.k8s.io/controller-runtime/pkg/client/interceptor"
)

// This file is a regression test for issue #42's actual reported scenario: a replica Pod with a
// permanently broken PVC never reaches the StatefulSet's updateRevision, so status.readyReplicas
// never reaches spec.replicas. Before the fix, waitForReadyStatus compared readyReplicas against
// the full replica count with no way to exclude the stuck Pod, so reconcileUpdates never got past
// its first call — the metadata.SkipUpdateAnnotation check further down in the replica loop was
// unreachable code for this exact scenario, the one the annotation exists to unblock.

// newSkipUpdateFixture builds a MariaDB with 3 replicas (index 0 primary, up to date; index 1 a
// replica stuck on the stale revision, annotated with metadata.SkipUpdateAnnotation, and never
// becoming Ready — simulating a broken PVC; index 2 a normal stale replica that should still get
// updated) and a StatefulSet whose status.readyReplicas reflects pod-1 being permanently down.
func newSkipUpdateFixture(t *testing.T) (*MariaDBReconciler, *mariadbv1alpha1.MariaDB) {
	t.Helper()

	scheme := runtime.NewScheme()
	require.NoError(t, mariadbv1alpha1.AddToScheme(scheme))
	require.NoError(t, appsv1.AddToScheme(scheme))
	require.NoError(t, corev1.AddToScheme(scheme))

	const (
		mdbName        = "test-mariadb"
		namespace      = "default"
		updateRevision = "rev-2"
		staleRevision  = "rev-1"
	)

	mdb := &mariadbv1alpha1.MariaDB{
		ObjectMeta: metav1.ObjectMeta{
			Name:      mdbName,
			Namespace: namespace,
		},
		Spec: mariadbv1alpha1.MariaDBSpec{
			Replicas: 3,
			UpdateStrategy: mariadbv1alpha1.UpdateStrategy{
				Type: mariadbv1alpha1.ReplicasFirstPrimaryLastUpdateType,
			},
		},
		Status: mariadbv1alpha1.MariaDBStatus{
			CurrentPrimary: ptr.To(mdbName + "-0"),
		},
	}

	sts := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      mdbName,
			Namespace: namespace,
		},
		Status: appsv1.StatefulSetStatus{
			UpdateRevision: updateRevision,
			// pod-1 (broken PVC) is permanently NotReady: only 2 of the 3 Pods are ready.
			ReadyReplicas: 2,
		},
	}

	podLabels := map[string]string{
		"app.kubernetes.io/name":     "mariadb",
		"app.kubernetes.io/instance": mdbName,
	}

	newPod := func(name, revision string, annotations map[string]string) *corev1.Pod {
		labels := make(map[string]string, len(podLabels)+1)
		for k, v := range podLabels {
			labels[k] = v
		}
		labels["controller-revision-hash"] = revision
		return &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:        name,
				Namespace:   namespace,
				Labels:      labels,
				Annotations: annotations,
			},
		}
	}
	primaryPod := newPod(mdbName+"-0", updateRevision, nil)
	stuckReplicaPod := newPod(mdbName+"-1", staleRevision, map[string]string{metadata.SkipUpdateAnnotation: ""})
	normalReplicaPod := newPod(mdbName+"-2", staleRevision, nil)

	interceptorFuncs := interceptor.Funcs{
		Delete: func(ctx context.Context, c client.WithWatch, obj client.Object, opts ...client.DeleteOption) error {
			if err := c.Delete(ctx, obj, opts...); err != nil {
				return err
			}
			pod, ok := obj.(*corev1.Pod)
			if !ok {
				return nil
			}

			// Simulate the StatefulSet controller recreating the Pod with the up to date revision.
			recreatedPod := pod.DeepCopy()
			recreatedPod.ResourceVersion = ""
			recreatedPod.UID = ""
			if recreatedPod.Labels == nil {
				recreatedPod.Labels = map[string]string{}
			}
			recreatedPod.Labels["controller-revision-hash"] = updateRevision
			if err := c.Create(ctx, recreatedPod); err != nil {
				return err
			}

			// pod-1 stays down throughout, so readyReplicas remains 2 even after pod-2 is
			// recreated (primary + recreated pod-2, pod-1 still broken).
			var latestSts appsv1.StatefulSet
			if err := c.Get(ctx, client.ObjectKeyFromObject(sts), &latestSts); err != nil {
				return err
			}
			latestSts.Status.ReadyReplicas = 2
			return c.Status().Update(ctx, &latestSts)
		},
	}

	fakeClient := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(mdb, sts, primaryPod, stuckReplicaPod, normalReplicaPod).
		WithInterceptorFuncs(interceptorFuncs).
		Build()

	reconciler := &MariaDBReconciler{
		Client: fakeClient,
	}
	return reconciler, mdb
}

// TestReconcileUpdatesSkipsPermanentlyStuckAnnotatedReplica proves the fix: with pod-1 annotated
// metadata.SkipUpdateAnnotation and permanently NotReady, reconcileUpdates must not requeue
// forever waiting for readyReplicas to reach spec.replicas (which pod-1 alone makes impossible) —
// it must proceed to update pod-2, the other stale (but healthy) replica.
func TestReconcileUpdatesSkipsPermanentlyStuckAnnotatedReplica(t *testing.T) {
	reconciler, mdb := newSkipUpdateFixture(t)

	result, err := reconciler.reconcileUpdates(context.Background(), mdb)

	require.NoError(t, err)
	// Before the fix, this would be ctrl.Result{RequeueAfter: 1 * time.Second} forever
	// (waitForReadyStatus blocking on readyReplicas == spec.replicas, which pod-1 can never
	// satisfy) — reconcileUpdates would never even reach the Pod loop that checks the
	// annotation. After the fix, pod-2 gets updated and the reconcile requeues immediately to
	// continue the rollout, same as the non-stuck case.
	require.Equal(t, ctrl.Result{Requeue: true}, result)

	var updatedPod2 corev1.Pod
	require.NoError(t, reconciler.Get(context.Background(), client.ObjectKey{Name: "test-mariadb-2", Namespace: "default"}, &updatedPod2))
	require.Equal(t, "rev-2", updatedPod2.Labels["controller-revision-hash"], "pod-2 should have been updated to the new revision")

	var stuckPod1 corev1.Pod
	require.NoError(t, reconciler.Get(context.Background(), client.ObjectKey{Name: "test-mariadb-1", Namespace: "default"}, &stuckPod1))
	require.Equal(t, "rev-1", stuckPod1.Labels["controller-revision-hash"], "pod-1 must not have been touched: it was skipped, not updated")
}

// TestWaitForReadyStatus_ExcludesSkippedPodsFromThreshold is a narrower unit test directly on
// waitForReadyStatus, isolating the threshold-calculation logic from the rest of reconcileUpdates.
func TestWaitForReadyStatus_ExcludesSkippedPodsFromThreshold(t *testing.T) {
	scheme := runtime.NewScheme()
	require.NoError(t, mariadbv1alpha1.AddToScheme(scheme))
	require.NoError(t, appsv1.AddToScheme(scheme))

	mdb := &mariadbv1alpha1.MariaDB{
		ObjectMeta: metav1.ObjectMeta{Name: "test-mariadb", Namespace: "default"},
		Spec:       mariadbv1alpha1.MariaDBSpec{Replicas: 3},
	}
	sts := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "test-mariadb", Namespace: "default"},
		Status:     appsv1.StatefulSetStatus{ReadyReplicas: 2},
	}
	fakeClient := fake.NewClientBuilder().WithScheme(scheme).WithObjects(mdb, sts).Build()
	reconciler := &MariaDBReconciler{Client: fakeClient}

	podsByRole := podRoleSet{
		primary: corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "test-mariadb-0"}},
		replicas: []corev1.Pod{
			{
				ObjectMeta: metav1.ObjectMeta{
					Name:        "test-mariadb-1",
					Annotations: map[string]string{metadata.SkipUpdateAnnotation: ""},
				},
			},
			{ObjectMeta: metav1.ObjectMeta{Name: "test-mariadb-2"}},
		},
	}

	result, err := reconciler.waitForReadyStatus(context.Background(), mdb, podsByRole, logr.Discard())
	require.NoError(t, err)
	require.True(t, result.IsZero(), "expected no requeue: 2 ready out of 3, with 1 skipped, meets the 2-Pod threshold")

	// Without the skip annotation, the same readyReplicas=2 must still block (3 required).
	podsByRole.replicas[0].Annotations = nil
	result, err = reconciler.waitForReadyStatus(context.Background(), mdb, podsByRole, logr.Discard())
	require.NoError(t, err)
	require.Equal(t, ctrl.Result{RequeueAfter: 1 * time.Second}, result)
}
