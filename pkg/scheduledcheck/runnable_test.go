package scheduledcheck

import (
	"context"
	"testing"
	"time"

	"github.com/go-logr/logr"
	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/refresolver"
	"github.com/prometheus/client_golang/prometheus/testutil"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func newRunnableTestScheme(t *testing.T) *runtime.Scheme {
	t.Helper()
	scheme := runtime.NewScheme()
	if err := clientgoscheme.AddToScheme(scheme); err != nil {
		t.Fatalf("error adding client-go scheme: %v", err)
	}
	if err := mariadbv1alpha1.AddToScheme(scheme); err != nil {
		t.Fatalf("error adding mariadbv1alpha1 scheme: %v", err)
	}
	return scheme
}

// TestRunCheck_PublishesMetricsOnACompletedScan is an end-to-end check that Runnable.runCheck
// wires CheckCrds's results through to the real gauges via metricsBatch.apply. Spec.Replicas: 0
// means checkPods' clientSet.Clients loop attempts no SQL connections, so this exercises the
// K8s-list-and-gauge-writing path without needing a live MariaDB — the SQL-dependent paths
// (PodNetworkStatusGauge, root password age) are covered separately by TestClassifyError_* and
// TestParseUnixTimestamp_*.
func TestRunCheck_PublishesMetricsOnACompletedScan(t *testing.T) {
	MariadbReadyGauge.Reset()
	defer MariadbReadyGauge.Reset()

	mdb := &mariadbv1alpha1.MariaDB{
		ObjectMeta: metav1.ObjectMeta{Name: "test-mdb", Namespace: "default"},
		Spec:       mariadbv1alpha1.MariaDBSpec{Replicas: 0},
		Status: mariadbv1alpha1.MariaDBStatus{
			Conditions: []metav1.Condition{
				{Type: "Ready", Status: metav1.ConditionTrue, Reason: "Ready", Message: "Ready"},
			},
		},
	}

	scheme := newRunnableTestScheme(t)
	fakeClient := fake.NewClientBuilder().WithScheme(scheme).WithObjects(mdb).WithStatusSubresource(mdb).Build()

	r := &Runnable{
		Client:            fakeClient,
		RefResolver:       refresolver.New(fakeClient),
		Namespaces:        []string{"default"},
		OperatorNamespace: "op-ns",
		OperatorName:      "op-name",
		Interval:          5 * time.Second,
		Logger:            logr.Discard(),
	}

	r.runCheck(context.Background())

	got := testutil.ToFloat64(MariadbReadyGauge.WithLabelValues("op-ns", "op-name", "default", "test-mdb"))
	if got != 1 {
		t.Errorf("expected MariadbReadyGauge to be 1 after a completed scan, got %v", got)
	}
}

// TestRunCheck_DoesNotPublishWhenAlreadyOutOfBudget is a regression test for the finding that a
// stuck scan should never publish a partial/empty result: it should instead leave whatever the
// previous tick published in place. This simulates "already out of budget" by passing an already
// canceled parent context, rather than by making an individual check hang (which would require
// faking a stuck SQL dial) — runCheck derives tickCtx from ctx via context.WithTimeout, so a
// canceled parent makes tickCtx canceled too, so runCheck's tickCtx.Err() check after the (only)
// namespace in the loop must skip calling batch.apply(). Deliberately no MariaDB CR named
// "previous-tick-mdb" exists in the fake client: if apply() were called anyway, CheckCrds finding
// zero CRs would still make it reset that series away, regardless of whether the fake client's
// List happens to honor context cancellation — so this isolates the assertion to runCheck's own
// skip-on-timeout logic rather than depending on List's behavior.
func TestRunCheck_DoesNotPublishWhenAlreadyOutOfBudget(t *testing.T) {
	MariadbReadyGauge.Reset()
	defer MariadbReadyGauge.Reset()

	// Simulate a value published by a previous, successful tick.
	previous := newMetricsBatch()
	previous.set(MariadbReadyGauge, 1, "op-ns", "op-name", "default", "previous-tick-mdb")
	previous.apply()

	scheme := newRunnableTestScheme(t)
	fakeClient := fake.NewClientBuilder().WithScheme(scheme).Build()

	r := &Runnable{
		Client:            fakeClient,
		RefResolver:       refresolver.New(fakeClient),
		Namespaces:        []string{"default"},
		OperatorNamespace: "op-ns",
		OperatorName:      "op-name",
		Interval:          5 * time.Second,
		Logger:            logr.Discard(),
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r.runCheck(ctx)

	got := testutil.ToFloat64(MariadbReadyGauge.WithLabelValues("op-ns", "op-name", "default", "previous-tick-mdb"))
	if got != 1 {
		t.Errorf("expected the previous tick's value (1) to remain published after an out-of-budget scan, got %v", got)
	}
}
