package controller

import (
	"context"
	"errors"
	"testing"

	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	condition "github.com/mariadb-operator/mariadb-operator/v26/pkg/condition"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/environment"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/refresolver"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	fakeclient "sigs.k8s.io/controller-runtime/pkg/client/fake"
	"sigs.k8s.io/controller-runtime/pkg/client/interceptor"
)

func newStatusTestMariaDB() *mariadbv1alpha1.MariaDB {
	return &mariadbv1alpha1.MariaDB{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-mariadb",
			Namespace: "default",
		},
		Spec: mariadbv1alpha1.MariaDBSpec{
			Replicas: 1,
		},
	}
}

func newStatusTestReconciler(t *testing.T, interceptorFuncs interceptor.Funcs) *MariaDBReconciler {
	t.Helper()
	scheme := runtime.NewScheme()
	if err := appsv1.AddToScheme(scheme); err != nil {
		t.Fatalf("error adding appsv1 to scheme: %v", err)
	}
	if err := mariadbv1alpha1.AddToScheme(scheme); err != nil {
		t.Fatalf("error adding mariadbv1alpha1 to scheme: %v", err)
	}

	fakeClient := fakeclient.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(newStatusTestMariaDB()).
		WithStatusSubresource(&mariadbv1alpha1.MariaDB{}).
		WithInterceptorFuncs(interceptorFuncs).
		Build()

	return &MariaDBReconciler{
		Client:         fakeClient,
		RefResolver:    refresolver.New(fakeClient),
		ConditionReady: &condition.Ready{},
		Environment: &environment.OperatorEnv{
			MariadbDefaultVersion: "11.8",
		},
	}
}

// TestReconcileStatus_StatefulSetGetError verifies the fix for #46: a transient (non-NotFound)
// error fetching the StatefulSet must abort the reconcile with an error instead of silently
// proceeding with a zero-value StatefulSet, which would otherwise misreport a healthy cluster
// as Ready=False.
func TestReconcileStatus_StatefulSetGetError(t *testing.T) {
	genericErr := errors.New("etcd request timed out")
	r := newStatusTestReconciler(t, interceptor.Funcs{
		Get: func(ctx context.Context, c client.WithWatch, key client.ObjectKey, obj client.Object, opts ...client.GetOption) error {
			if _, ok := obj.(*appsv1.StatefulSet); ok {
				return genericErr
			}
			return c.Get(ctx, key, obj, opts...)
		},
	})

	mdb := newStatusTestMariaDB()
	if err := r.Get(context.Background(), client.ObjectKeyFromObject(mdb), mdb); err != nil {
		t.Fatalf("error fetching seed MariaDB: %v", err)
	}

	if _, err := r.reconcileStatus(context.Background(), mdb); err == nil {
		t.Fatal("expected reconcileStatus to return an error on a transient StatefulSet Get failure, got nil")
	}
}

// TestReconcileStatus_StatefulSetNotFound verifies that a genuine NotFound (StatefulSet not
// created yet, e.g. right after MariaDB creation) is still treated as a normal, non-error state.
func TestReconcileStatus_StatefulSetNotFound(t *testing.T) {
	r := newStatusTestReconciler(t, interceptor.Funcs{})

	mdb := newStatusTestMariaDB()
	if err := r.Get(context.Background(), client.ObjectKeyFromObject(mdb), mdb); err != nil {
		t.Fatalf("error fetching seed MariaDB: %v", err)
	}

	if _, err := r.reconcileStatus(context.Background(), mdb); err != nil {
		t.Fatalf("expected no error when StatefulSet is simply not found yet, got: %v", err)
	}
}
