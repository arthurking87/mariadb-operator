package predicate

import (
	"regexp"

	"github.com/prometheus/client_golang/prometheus"
	crmetrics "sigs.k8s.io/controller-runtime/pkg/metrics"

	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/event"
	"sigs.k8s.io/controller-runtime/pkg/predicate"
)

// mariadbReplRegex matches the internal replication plumbing resources
// (e.g. Secrets/ConfigMaps named "<mariadb>-mariadb-repl-<n>") that aren't
// the user-facing MariaDB object itself. Predicates can use it to avoid
// triggering reconciles for events on these non-DB-related resources.
var mariadbReplRegex = regexp.MustCompile(`.*-mariadb-repl-.*`)

// filteredEventsTotal counts events seen by predicates in this package,
// broken down by which predicate evaluated them and whether the event was
// let through to the reconciler or filtered out. This lets us observe how
// noisy/effective each predicate is without having to add ad-hoc logging.
var filteredEventsTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "mariadb_operator_predicate_events_total",
		Help: "Number of watch events evaluated by mariadb-operator predicates, by predicate name and outcome.",
	},
	[]string{"predicate", "result"},
)

func init() {
	crmetrics.Registry.MustRegister(filteredEventsTotal)
}

func observe(predicateName string, passed bool) bool {
	result := "filtered"
	if passed {
		result = "passed"
	}
	filteredEventsTotal.WithLabelValues(predicateName, result).Inc()
	return passed
}

// IsMariadbReplRelated reports whether the object's name matches the
// internal replication plumbing naming scheme (see mariadbReplRegex).
func IsMariadbReplRelated(o client.Object) bool {
	return mariadbReplRegex.MatchString(o.GetName())
}

func PredicateWithAnnotations(annotations []string) predicate.Predicate {
	return PredicateChangedWithAnnotations(annotations, func(old, new client.Object) bool {
		return true
	})
}

func PredicateWithLabel(label string) predicate.Predicate {
	const name = "PredicateWithLabel"
	return predicate.Funcs{
		CreateFunc: func(e event.CreateEvent) bool {
			return observe(name, hasLabel(e.Object, label))
		},
		DeleteFunc: func(e event.DeleteEvent) bool {
			return observe(name, hasLabel(e.Object, label))
		},
		UpdateFunc: func(e event.UpdateEvent) bool {
			return observe(name, hasLabel(e.ObjectNew, label))
		},
		GenericFunc: func(e event.GenericEvent) bool {
			return observe(name, hasLabel(e.Object, label))
		},
	}
}

func PredicateChangedWithAnnotations(annotations []string, hasChanged func(old, new client.Object) bool) predicate.Predicate {
	const name = "PredicateChangedWithAnnotations"
	return predicate.Funcs{
		CreateFunc: func(e event.CreateEvent) bool {
			return observe(name, hasAnnotations(e.Object, annotations))
		},
		DeleteFunc: func(e event.DeleteEvent) bool {
			return observe(name, false)
		},
		UpdateFunc: func(e event.UpdateEvent) bool {
			if !hasAnnotations(e.ObjectOld, annotations) || !hasAnnotations(e.ObjectNew, annotations) {
				return observe(name, false)
			}
			return observe(name, hasChanged(e.ObjectOld, e.ObjectNew))
		},
		GenericFunc: func(e event.GenericEvent) bool {
			return observe(name, hasAnnotations(e.Object, annotations))
		},
	}
}

func hasAnnotations(o client.Object, annotations []string) bool {
	objAnnotations := o.GetAnnotations()
	for _, a := range annotations {
		if _, ok := objAnnotations[a]; !ok {
			return false
		}
	}
	return true
}

func hasLabel(o client.Object, label string) bool {
	_, hasLabel := o.GetLabels()[label]
	return hasLabel
}
