package controller

import (
	"context"
	"testing"

	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/builder"
	labelsbuilder "github.com/mariadb-operator/mariadb-operator/v26/pkg/builder/labels"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/controller/endpoints"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/discovery"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/environment"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/statefulset"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

// This test file provides regression coverage for the wiring introduced to fix
// https://github.com/mariadb-operator/mariadb-operator/issues/33: a REPLICA Pod
// transitioning Ready<->NotReady must trigger EndpointsReconciler.Reconcile so
// that the secondary-svc EndpointSlice reflects the replica's readiness.
//
// It exercises PodReplicationController.ReconcilePodReady/ReconcilePodNotReady
// directly against a fake controller-runtime client (rather than a full envtest
// suite, which in this repo requires UseExistingCluster: true, i.e. a real
// Kubernetes cluster) so that it can run fast and hermetically while still
// proving the real wiring: EndpointsReconciler itself only depends on
// client.Client, so any EndpointSlice mutation observed here was genuinely
// produced by the reconciler being invoked, not asserted tautologically.

// newFakeReplicationScheme builds a runtime.Scheme with all the types needed to
// create MariaDB, Pod and EndpointSlice objects in a fake client.
func newFakeReplicationScheme(t *testing.T) *runtime.Scheme {
	t.Helper()
	scheme := runtime.NewScheme()
	utilruntime.Must(clientgoscheme.AddToScheme(scheme))
	utilruntime.Must(mariadbv1alpha1.AddToScheme(scheme))
	return scheme
}

// newFakePodReplicationController builds a PodReplicationController wired to a
// real EndpointsReconciler (backed by the fake client), mirroring exactly how
// cmd/controller/main.go and internal/controller/suite_test.go wire it up.
func newFakePodReplicationController(t *testing.T, initObjs ...client.Object) (PodReadinessController, client.Client) {
	t.Helper()
	scheme := newFakeReplicationScheme(t)

	fakeClient := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(initObjs...).
		Build()

	disc, err := discovery.NewFakeDiscovery()
	if err != nil {
		t.Fatalf("unexpected error creating fake discovery: %v", err)
	}
	env := &environment.OperatorEnv{
		MariadbOperatorName:      "mariadb-operator",
		MariadbOperatorNamespace: testNamespace,
		MariadbOperatorSAPath:    "/var/run/secrets/kubernetes.io/serviceaccount/token",
		MariadbOperatorImage:     "mariadb-operator:test",
		RelatedMariadbImage:      "mariadb:test",
		RelatedMaxscaleImage:     "maxscale:test",
		RelatedExporterImage:     "mysql-exporter:test",
		MariadbGaleraLibPath:     "/usr/lib/galera/libgalera_smm.so",
	}
	b := builder.NewBuilder(scheme, env, disc)
	endpointsReconciler := endpoints.NewEndpointsReconciler(fakeClient, b)

	podReplicationController := NewPodReplicationController(fakeClient, nil, endpointsReconciler)
	return podReplicationController, fakeClient
}

// newFakeReplMariaDB returns a MariaDB with replication enabled, ready to
// satisfy both ReconcilePodReady (requires Status.CurrentPrimaryPodIndex) and
// ReconcilePodNotReady's shouldReconcile() gate (requires replication enabled,
// auto failover, and a configured replica).
func newFakeReplMariaDB(name string, replicas int32, primaryIndex int) *mariadbv1alpha1.MariaDB {
	mdb := &mariadbv1alpha1.MariaDB{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: testNamespace,
			UID:       types.UID("uid-" + name),
		},
		Spec: mariadbv1alpha1.MariaDBSpec{
			Replicas: replicas,
			Port:     3306,
			Replication: &mariadbv1alpha1.Replication{
				Enabled: true,
				ReplicationSpec: mariadbv1alpha1.ReplicationSpec{
					Primary: mariadbv1alpha1.PrimaryReplication{
						PodIndex: ptr.To(primaryIndex),
					},
				},
			},
		},
		Status: mariadbv1alpha1.MariaDBStatus{
			CurrentPrimaryPodIndex: ptr.To(primaryIndex),
			Replication: &mariadbv1alpha1.ReplicationStatus{
				Roles: map[string]mariadbv1alpha1.ReplicationRole{},
			},
		},
	}
	for i := 0; i < int(replicas); i++ {
		podName := statefulset.PodName(mdb.ObjectMeta, i)
		if i == primaryIndex {
			mdb.Status.Replication.Roles[podName] = mariadbv1alpha1.ReplicationRolePrimary
		} else {
			mdb.Status.Replication.Roles[podName] = mariadbv1alpha1.ReplicationRoleReplica
		}
	}
	return mdb
}

// newFakeReplPod returns a Pod belonging to mdb at the given StatefulSet index,
// with the Pod IP/NodeName set (required by EndpointsReconciler to build an
// Endpoint) and the corev1.PodReady condition set according to ready.
func newFakeReplPod(mdb *mariadbv1alpha1.MariaDB, index int, podIP string, ready bool) *corev1.Pod {
	status := corev1.ConditionFalse
	if ready {
		status = corev1.ConditionTrue
	}
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      statefulset.PodName(mdb.ObjectMeta, index),
			Namespace: mdb.Namespace,
			Labels:    labelsbuilder.NewLabelsBuilder().WithMariaDBSelectorLabels(mdb).Build(),
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
		},
		Status: corev1.PodStatus{
			PodIP: podIP,
			Conditions: []corev1.PodCondition{
				{
					Type:   corev1.PodReady,
					Status: status,
				},
			},
		},
	}
}

// updatePodReadyCondition fetches the current version of the named Pod from
// fakeClient, flips its corev1.PodReady condition to the given state, and
// persists the change via the status subresource, returning the updated Pod.
// Fetching first keeps ResourceVersion in sync with the fake client's object
// tracker. The fake client (like a real API server) only applies Status
// changes through Status().Update, not through a plain Update.
func updatePodReadyCondition(t *testing.T, ctx context.Context, fakeClient client.Client, name, namespace string, ready bool) *corev1.Pod {
	t.Helper()
	var pod corev1.Pod
	if err := fakeClient.Get(ctx, types.NamespacedName{Name: name, Namespace: namespace}, &pod); err != nil {
		t.Fatalf("unexpected error getting Pod %q: %v", name, err)
	}
	status := corev1.ConditionFalse
	if ready {
		status = corev1.ConditionTrue
	}
	pod.Status.Conditions = []corev1.PodCondition{
		{
			Type:   corev1.PodReady,
			Status: status,
		},
	}
	if err := fakeClient.Status().Update(ctx, &pod); err != nil {
		t.Fatalf("unexpected error updating Pod %q readiness to %v: %v", name, ready, err)
	}
	return &pod
}

// endpointFor returns the Endpoint in slice targeting the given Pod name, or
// nil (with t.Fatal) if not found.
func endpointFor(t *testing.T, slice *discoveryv1.EndpointSlice, podName string) *discoveryv1.Endpoint {
	t.Helper()
	for i := range slice.Endpoints {
		ep := &slice.Endpoints[i]
		if ep.TargetRef != nil && ep.TargetRef.Name == podName {
			return ep
		}
	}
	t.Fatalf("no Endpoint found in EndpointSlice for Pod %q, got endpoints: %+v", podName, slice.Endpoints)
	return nil
}

// TestPodReplicationController_ReplicaReadinessUpdatesSecondaryEndpointSlice is
// the regression test for issue #33 / PR #57: it proves that
// PodReplicationController.ReconcilePodReady / ReconcilePodNotReady, when
// invoked for a REPLICA Pod, actually call EndpointsReconciler.Reconcile and
// that this results in the secondary-svc EndpointSlice being created/updated
// with the replica's Conditions.Ready reflecting its current state.
//
// Before the fix under test, these methods were no-ops for replica Pods (they
// returned nil immediately), so no EndpointSlice would ever be created here and
// this test would fail.
func TestPodReplicationController_ReplicaReadinessUpdatesSecondaryEndpointSlice(t *testing.T) {
	ctx := context.Background()

	mdb := newFakeReplMariaDB("mariadb-repl-test", 2, 0)
	primaryPod := newFakeReplPod(mdb, 0, "10.0.0.10", true)
	replicaPod := newFakeReplPod(mdb, 1, "10.0.0.11", true)

	podReplicationController, fakeClient := newFakePodReplicationController(t, mdb, primaryPod, replicaPod)

	secondaryKey := mdb.SecondaryServiceKey()

	t.Run("replica pod ready creates secondary EndpointSlice with Ready=true", func(t *testing.T) {
		if err := podReplicationController.ReconcilePodReady(ctx, *replicaPod, mdb); err != nil {
			t.Fatalf("unexpected error from ReconcilePodReady: %v", err)
		}

		var slice discoveryv1.EndpointSlice
		if err := fakeClient.Get(ctx, secondaryKey, &slice); err != nil {
			t.Fatalf("expected secondary EndpointSlice %s to be created, got error: %v", secondaryKey, err)
		}

		ep := endpointFor(t, &slice, replicaPod.Name)
		if ep.Conditions.Ready == nil || !*ep.Conditions.Ready {
			t.Fatalf("expected Endpoint for %q to be Ready=true, got: %+v", replicaPod.Name, ep.Conditions.Ready)
		}
	})

	t.Run("replica pod not ready flips Endpoint Ready to false", func(t *testing.T) {
		// Reflect the transition in the fake client too, since ListMariaDBSecondaryPods
		// re-lists Pods from the client rather than trusting the argument alone.
		// Fetch-mutate-update (rather than constructing a fresh object) so the
		// ResourceVersion always matches what the fake client's tracker expects.
		notReadyPod := updatePodReadyCondition(t, ctx, fakeClient, replicaPod.Name, replicaPod.Namespace, false)

		if err := podReplicationController.ReconcilePodNotReady(ctx, *notReadyPod, mdb); err != nil {
			t.Fatalf("unexpected error from ReconcilePodNotReady: %v", err)
		}

		var slice discoveryv1.EndpointSlice
		if err := fakeClient.Get(ctx, secondaryKey, &slice); err != nil {
			t.Fatalf("expected secondary EndpointSlice %s to still exist, got error: %v", secondaryKey, err)
		}

		ep := endpointFor(t, &slice, replicaPod.Name)
		if ep.Conditions.Ready == nil || *ep.Conditions.Ready {
			t.Fatalf("expected Endpoint for %q to be Ready=false after replica went NotReady, got: %+v", replicaPod.Name, ep.Conditions.Ready)
		}
	})

	t.Run("replica pod ready again flips Endpoint Ready back to true", func(t *testing.T) {
		readyAgainPod := updatePodReadyCondition(t, ctx, fakeClient, replicaPod.Name, replicaPod.Namespace, true)

		if err := podReplicationController.ReconcilePodReady(ctx, *readyAgainPod, mdb); err != nil {
			t.Fatalf("unexpected error from ReconcilePodReady: %v", err)
		}

		var slice discoveryv1.EndpointSlice
		if err := fakeClient.Get(ctx, secondaryKey, &slice); err != nil {
			t.Fatalf("expected secondary EndpointSlice %s to still exist, got error: %v", secondaryKey, err)
		}

		ep := endpointFor(t, &slice, replicaPod.Name)
		if ep.Conditions.Ready == nil || !*ep.Conditions.Ready {
			t.Fatalf("expected Endpoint for %q to be Ready=true again, got: %+v", replicaPod.Name, ep.Conditions.Ready)
		}
	})
}

// TestPodReplicationController_PrimaryPodReadyDoesNotTouchSecondaryEndpoints
// asserts that the new endpoint-reconciling behavior is specific to replica
// Pods: reconciling the PRIMARY Pod must not create/touch the secondary-svc
// EndpointSlice via this code path (the primary branch has its own,
// unrelated logic).
func TestPodReplicationController_PrimaryPodReadyDoesNotTouchSecondaryEndpoints(t *testing.T) {
	ctx := context.Background()

	mdb := newFakeReplMariaDB("mariadb-repl-primary-test", 2, 0)
	primaryPod := newFakeReplPod(mdb, 0, "10.0.0.20", true)
	replicaPod := newFakeReplPod(mdb, 1, "10.0.0.21", true)

	podReplicationController, fakeClient := newFakePodReplicationController(t, mdb, primaryPod, replicaPod)
	secondaryKey := mdb.SecondaryServiceKey()

	if err := podReplicationController.ReconcilePodReady(ctx, *primaryPod, mdb); err != nil {
		t.Fatalf("unexpected error from ReconcilePodReady on primary Pod: %v", err)
	}

	var slice discoveryv1.EndpointSlice
	err := fakeClient.Get(ctx, secondaryKey, &slice)
	if !apierrors.IsNotFound(err) {
		t.Fatalf("expected no secondary EndpointSlice to be created when reconciling the primary Pod, got err=%v slice=%+v", err, slice)
	}
}
