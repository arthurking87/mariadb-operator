package controller

import (
	"context"
	"errors"
	"testing"

	"github.com/go-logr/logr"
	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/events"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
	"sigs.k8s.io/controller-runtime/pkg/client/interceptor"
)

// fakeEventRecorder is a no-op implementation of events.EventRecorder used to
// satisfy PodReplicationController.recorder in unit tests.
type fakeEventRecorder struct{}

func (f *fakeEventRecorder) Eventf(regarding, related runtime.Object, eventtype, reason, action, note string, args ...interface{}) {
}

var _ events.EventRecorder = &fakeEventRecorder{}

func newPromoteTestScheme(t *testing.T) *runtime.Scheme {
	t.Helper()
	scheme := runtime.NewScheme()
	if err := clientgoscheme.AddToScheme(scheme); err != nil {
		t.Fatalf("error adding client-go scheme: %v", err)
	}
	if err := mariadbv1alpha1.AddToScheme(scheme); err != nil {
		t.Fatalf("error adding mariadb scheme: %v", err)
	}
	return scheme
}

func newPromoteTestFixtures() (*mariadbv1alpha1.MariaDB, *corev1.Pod) {
	mariadb := &mariadbv1alpha1.MariaDB{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "mariadb-test",
			Namespace: "default",
		},
		Spec: mariadbv1alpha1.MariaDBSpec{
			Replication: &mariadbv1alpha1.Replication{
				Enabled: true,
				ReplicationSpec: mariadbv1alpha1.ReplicationSpec{
					Primary: mariadbv1alpha1.PrimaryReplication{
						PodIndex: ptr.To(0),
					},
				},
			},
		},
		Status: mariadbv1alpha1.MariaDBStatus{
			CurrentPrimaryPodIndex:     ptr.To(0),
			CurrentPrimaryFailingSince: &metav1.Time{},
		},
	}

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "mariadb-test-0",
			Namespace: "default",
			UID:       types.UID("old-primary-uid"),
		},
	}

	return mariadb, pod
}

// TestPodReplicationController_promoteReplica_DeleteBeforePatch is a regression test for
// https://github.com/mariadb-operator/mariadb-operator/issues/7 and
// https://github.com/mariadb-operator/mariadb-operator/issues/9.
//
// It asserts that promoteReplica deletes the old primary Pod before (and independently of)
// patching the MariaDB spec/status: even when the subsequent patches fail, the Pod deletion
// must have already been committed, so that a transient patch/Delete failure can be retried
// safely instead of getting stranded with the old primary still holding connections open.
func TestPodReplicationController_promoteReplica_DeleteBeforePatch(t *testing.T) {
	scheme := newPromoteTestScheme(t)
	mariadb, pod := newPromoteTestFixtures()

	fakeClient := fake.NewClientBuilder().
		WithScheme(scheme).
		WithStatusSubresource(&mariadbv1alpha1.MariaDB{}).
		WithObjects(mariadb, pod).
		WithInterceptorFuncs(interceptor.Funcs{
			Patch: func(ctx context.Context, c client.WithWatch, obj client.Object, patch client.Patch, opts ...client.PatchOption) error {
				return errors.New("boom")
			},
		}).
		Build()

	r := &PodReplicationController{
		Client:   fakeClient,
		recorder: &fakeEventRecorder{},
	}

	err := r.promoteReplica(context.Background(), *pod, mariadb, ptr.To(0), ptr.To(1), logr.Discard())
	if err == nil {
		t.Fatal("expected promoteReplica to return an error when the patch fails, got nil")
	}

	var gotPod corev1.Pod
	getErr := fakeClient.Get(context.Background(), types.NamespacedName{Name: pod.Name, Namespace: pod.Namespace}, &gotPod)
	if getErr == nil {
		t.Fatal("expected the old primary Pod to have been deleted despite the patch failure, but it still exists")
	}
	if !apierrors.IsNotFound(getErr) {
		t.Fatalf("expected a NotFound error when getting the deleted Pod, got: %v", getErr)
	}
}

// TestPodReplicationController_promoteReplica_HappyPath asserts that, absent any errors,
// promoteReplica deletes the old primary Pod, patches spec.replication.primary.podIndex to
// the new primary index and clears status.currentPrimaryFailingSince.
func TestPodReplicationController_promoteReplica_HappyPath(t *testing.T) {
	scheme := newPromoteTestScheme(t)
	mariadb, pod := newPromoteTestFixtures()

	fakeClient := fake.NewClientBuilder().
		WithScheme(scheme).
		WithStatusSubresource(&mariadbv1alpha1.MariaDB{}).
		WithObjects(mariadb, pod).
		Build()

	r := &PodReplicationController{
		Client:   fakeClient,
		recorder: &fakeEventRecorder{},
	}

	newPrimary := 1
	err := r.promoteReplica(context.Background(), *pod, mariadb, ptr.To(0), &newPrimary, logr.Discard())
	if err != nil {
		t.Fatalf("expected promoteReplica to succeed, got error: %v", err)
	}

	var gotPod corev1.Pod
	getErr := fakeClient.Get(context.Background(), types.NamespacedName{Name: pod.Name, Namespace: pod.Namespace}, &gotPod)
	if !apierrors.IsNotFound(getErr) {
		t.Fatalf("expected the old primary Pod to have been deleted, got err: %v", getErr)
	}

	var gotMariadb mariadbv1alpha1.MariaDB
	mariadbKey := types.NamespacedName{Name: mariadb.Name, Namespace: mariadb.Namespace}
	if err := fakeClient.Get(context.Background(), mariadbKey, &gotMariadb); err != nil {
		t.Fatalf("error getting MariaDB: %v", err)
	}
	if gotMariadb.Spec.Replication.Primary.PodIndex == nil || *gotMariadb.Spec.Replication.Primary.PodIndex != newPrimary {
		t.Fatalf("expected spec.replication.primary.podIndex to be %d, got %v", newPrimary, gotMariadb.Spec.Replication.Primary.PodIndex)
	}
	if gotMariadb.Status.CurrentPrimaryFailingSince != nil {
		t.Fatalf("expected status.currentPrimaryFailingSince to be nil, got %v", gotMariadb.Status.CurrentPrimaryFailingSince)
	}
}
