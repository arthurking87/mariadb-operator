package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	ctrlmetrics "sigs.k8s.io/controller-runtime/pkg/metrics"
)

var (
	// SwitchoverDuration tracks the total duration of each switchover as a histogram
	// (distribution across all switchovers).
	SwitchoverDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "mariadb_operator_switchover_duration_seconds",
			Help:    "Duration in seconds of a MariaDB primary switchover.",
			Buckets: []float64{1, 5, 10, 30, 60, 120},
		},
		[]string{"namespace", "mariadb", "result"},
	)

	// SwitchoverLastDuration tracks the most recent switchover duration per MariaDB
	// instance. No result label: a Gauge with a result dimension produces stale
	// failure series that never update after a successful recovery.
	SwitchoverLastDuration = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "mariadb_operator_switchover_last_duration_seconds",
			Help: "Duration in seconds of the last MariaDB primary switchover.",
		},
		[]string{"namespace", "mariadb"},
	)

	// SwitchoverPhaseDuration tracks per-phase duration as a histogram.
	// Buckets extend to 120s to accommodate user-configurable SyncTimeout values
	// that may exceed the default 10s.
	SwitchoverPhaseDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "mariadb_operator_switchover_phase_duration_seconds",
			Help:    "Duration in seconds of each phase within a MariaDB primary switchover.",
			Buckets: []float64{0.1, 0.5, 1, 5, 10, 30, 60, 120},
		},
		[]string{"namespace", "mariadb", "phase", "result"},
	)

	// SwitchoverPhaseLastDuration tracks the most recent duration per phase.
	// No result label for the same reason as SwitchoverLastDuration.
	SwitchoverPhaseLastDuration = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "mariadb_operator_switchover_phase_last_duration_seconds",
			Help: "Duration in seconds of the last execution of each phase within a MariaDB primary switchover.",
		},
		[]string{"namespace", "mariadb", "phase"},
	)

	// SwitchoverTotal counts completed switchovers by transition path.
	// from/to labels identify which pod index was primary before and after,
	// enabling per-path frequency analysis without polluting the timing histograms
	// with high-cardinality labels.
	SwitchoverTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "mariadb_operator_switchover_total",
			Help: "Total number of MariaDB primary switchovers by transition path.",
		},
		[]string{"namespace", "mariadb", "from", "to", "result"},
	)
)

func init() {
	ctrlmetrics.Registry.MustRegister(
		SwitchoverDuration,
		SwitchoverLastDuration,
		SwitchoverPhaseDuration,
		SwitchoverPhaseLastDuration,
		SwitchoverTotal,
	)
}
