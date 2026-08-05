package controller

import (
	"context"
	"testing"
	"time"

	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
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

// newReconcileUpdatesFixture builds a MariaDB, a StatefulSet and two Pods (one primary, one
// replica) that are both stale with respect to the StatefulSet's updateRevision. It wires an
// interceptor around the fake client's Delete so that, when reconcileUpdates deletes the stale
// replica Pod (as part of updatePod), the Pod is immediately "recreated" by the (simulated)
// StatefulSet controller with the up to date controller-revision-hash label -- mirroring what
// happens on a real cluster -- and the StatefulSet's status.readyReplicas is set to
// readyReplicasAfterUpdate, simulating the StatefulSet status lagging behind the Pod replacement.
func newReconcileUpdatesFixture(t *testing.T, readyReplicasAfterUpdate int32) (*MariaDBReconciler, *mariadbv1alpha1.MariaDB) {
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
			Replicas: 2,
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
			ReadyReplicas:  2,
		},
	}

	podLabels := map[string]string{
		"app.kubernetes.io/name":     "mariadb",
		"app.kubernetes.io/instance": mdbName,
	}

	newPod := func(name string) *corev1.Pod {
		labels := make(map[string]string, len(podLabels)+1)
		for k, v := range podLabels {
			labels[k] = v
		}
		labels["controller-revision-hash"] = staleRevision
		return &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:      name,
				Namespace: namespace,
				Labels:    labels,
			},
		}
	}
	primaryPod := newPod(mdbName + "-0")
	replicaPod := newPod(mdbName + "-1")

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

			// Simulate the StatefulSet status lagging behind the Pod replacement.
			var latestSts appsv1.StatefulSet
			if err := c.Get(ctx, client.ObjectKeyFromObject(sts), &latestSts); err != nil {
				return err
			}
			latestSts.Status.ReadyReplicas = readyReplicasAfterUpdate
			return c.Status().Update(ctx, &latestSts)
		},
	}

	fakeClient := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(mdb, sts, primaryPod, replicaPod).
		WithInterceptorFuncs(interceptorFuncs).
		Build()

	reconciler := &MariaDBReconciler{
		Client: fakeClient,
	}
	return reconciler, mdb
}

// TestReconcileUpdatesWaitsForReadyStatusAfterReplicaUpdate is a regression test for
// https://github.com/mariadb-operator/mariadb-operator/issues/41: after updating a stale replica
// Pod, reconcileUpdates must gate on waitForReadyStatus instead of unconditionally requeuing,
// so that the next replica (or the primary) is not updated before the StatefulSet has caught up.
func TestReconcileUpdatesWaitsForReadyStatusAfterReplicaUpdate(t *testing.T) {
	// The StatefulSet is fully Ready when reconcileUpdates starts, but its status.readyReplicas
	// lags behind (drops to 1) right after the stale replica Pod is deleted and recreated -- the
	// exact race the fix addresses.
	reconciler, mdb := newReconcileUpdatesFixture(t, 1)

	result, err := reconciler.reconcileUpdates(context.Background(), mdb)

	require.NoError(t, err)
	require.Equal(t, ctrl.Result{RequeueAfter: 1 * time.Second}, result)
}

// TestReconcileUpdatesRequeuesImmediatelyWhenReady confirms the fix does not change behavior when
// the StatefulSet is (still) fully Ready right after the replica Pod update: reconcileUpdates
// should requeue immediately, same as before the fix.
func TestReconcileUpdatesRequeuesImmediatelyWhenReady(t *testing.T) {
	reconciler, mdb := newReconcileUpdatesFixture(t, 2)

	result, err := reconciler.reconcileUpdates(context.Background(), mdb)

	require.NoError(t, err)
	require.Equal(t, ctrl.Result{Requeue: true}, result)
}
