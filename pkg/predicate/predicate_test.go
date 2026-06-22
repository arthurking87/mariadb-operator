package predicate

import (
	"testing"

	"github.com/prometheus/client_golang/prometheus/testutil"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/event"
)

func TestIsMariadbReplRelated(t *testing.T) {
	tests := []struct {
		name     string
		objName  string
		expected bool
	}{
		{name: "repl secret matches", objName: "mariadb-mariadb-repl-0", expected: true},
		{name: "unrelated secret does not match", objName: "mariadb-root-password", expected: false},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			obj := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: tt.objName}}
			if got := IsMariadbReplRelated(obj); got != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, got)
			}
		})
	}
}

func TestPredicateWithLabelCountsEvents(t *testing.T) {
	filteredEventsTotal.Reset()
	pred := PredicateWithLabel("foo")

	withLabel := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"foo": "bar"}}}
	withoutLabel := &corev1.Secret{}

	pred.Create(event.CreateEvent{Object: withLabel})
	pred.Create(event.CreateEvent{Object: withoutLabel})

	passed := testutil.ToFloat64(filteredEventsTotal.WithLabelValues("PredicateWithLabel", "passed"))
	filtered := testutil.ToFloat64(filteredEventsTotal.WithLabelValues("PredicateWithLabel", "filtered"))
	if passed != 1 {
		t.Errorf("expected 1 passed event, got %v", passed)
	}
	if filtered != 1 {
		t.Errorf("expected 1 filtered event, got %v", filtered)
	}
}
