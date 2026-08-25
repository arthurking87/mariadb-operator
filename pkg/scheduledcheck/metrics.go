package scheduledcheck

import (
	"sync"

	"github.com/prometheus/client_golang/prometheus"
	ctrlmetrics "sigs.k8s.io/controller-runtime/pkg/metrics"
)

// All gauges share the same identity labels (operator_namespace, operator_name,
// namespace, name) so they can be joined/filtered consistently in Grafana/PromQL,
// plus whatever extra labels each check needs.
var (
	// MariadbReadyGauge reports whether a MariaDB CR is Ready (1) or not (0). Despite
	// the metric name's "crd" wording below (kept for backwards compatibility), this
	// reports the readiness of the CR instance, not of the CustomResourceDefinition
	// schema itself.
	MariadbReadyGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "mariadb_operator_crd_status",
			Help: "Whether a MariaDB CR is Ready (1) or not (0).",
		},
		[]string{"operator_namespace", "operator_name", "namespace", "name"},
	)

	// MariadbSwitchoverStatusGauge reports whether a MariaDB primary switchover is
	// currently in progress (1) or not (0).
	MariadbSwitchoverStatusGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "mariadb_operator_mariadb_switchover_status",
			Help: "Whether a MariaDB primary switchover is currently in progress (1) or not (0).",
		},
		[]string{"operator_namespace", "operator_name", "namespace", "name"},
	)

	// MariadbStatusSingleConditionGauge reports the status of each individual
	// condition on a MariaDB CR: 1=True, 0=False, -1=Unknown.
	MariadbStatusSingleConditionGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "mariadb_operator_mariadb_condition_status",
			Help: "Status of each MariaDB condition. 1=True, 0=False, -1=Unknown.",
		},
		[]string{"operator_namespace", "operator_name", "namespace", "name", "condition", "reason"},
	)

	// PodStatusGauge reports whether a MariaDB Pod is Ready (1) or not (0).
	PodStatusGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "mariadb_operator_pod_status",
			Help: "Whether a MariaDB Pod is Ready (1) or not (0).",
		},
		[]string{"operator_namespace", "operator_name", "namespace", "name", "pod"},
	)

	// PodNetworkStatusGauge reports whether the operator could open a SQL connection
	// to a Pod's MariaDB port (1) or not (0). The "error" label is a small bounded
	// category (see classifyError), never the raw error string: including arbitrary
	// error text (which varies with IP/port/timing details) would create a new
	// Prometheus series per distinct message, growing the TSDB's cardinality without
	// bound over the operator's lifetime.
	PodNetworkStatusGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "mariadb_operator_pod_network_status",
			Help: "Whether the operator could open a SQL connection to a Pod (1) or not (0).",
		},
		[]string{"operator_namespace", "operator_name", "namespace", "name", "pod", "error"},
	)

	// PodSetsMultDomainIdGauge reports whether the Pods of a MariaDB report more than
	// one distinct gtid_domain_id (1=inconsistent, 0=consistent).
	PodSetsMultDomainIdGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "mariadb_operator_pod_sets_multi_domain_id",
			Help: "Whether the Pods of a MariaDB report more than one distinct gtid_domain_id (1=inconsistent, 0=consistent).",
		},
		[]string{"operator_namespace", "operator_name", "namespace", "name", "domain_ids"},
	)

	// PodRootPasswordFreshGauge reports, per Pod and per root@host account found in
	// mysql.global_priv, whether the password was changed within the configured max
	// age (1=fresh) or not / check failed (0). The max age itself isn't part of the
	// metric name since it's operator-configurable (--root-password-max-age), unlike
	// the fixed 90-day wording this metric originally shipped with. The "error" label
	// is a small bounded category (see rootPasswordCheckError*), never the raw error
	// text, for the same cardinality reason as PodNetworkStatusGauge.
	PodRootPasswordFreshGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "mariadb_operator_pod_root_password_fresh",
			Help: "Whether the root password was changed within the configured max age (1=fresh, 0=stale or check failed).",
		},
		[]string{"operator_namespace", "operator_name", "namespace", "name", "pod", "host", "user", "error"},
	)
)

func init() {
	ctrlmetrics.Registry.MustRegister(
		MariadbReadyGauge,
		MariadbSwitchoverStatusGauge,
		MariadbStatusSingleConditionGauge,
		PodStatusGauge,
		PodNetworkStatusGauge,
		PodSetsMultDomainIdGauge,
		PodRootPasswordFreshGauge,
	)
}

// resetAll clears every series of every gauge in this package. Only called from
// metricsBatch.apply, never directly from a scan in progress — see metricsBatch's doc comment.
func resetAll() {
	MariadbReadyGauge.Reset()
	MariadbSwitchoverStatusGauge.Reset()
	MariadbStatusSingleConditionGauge.Reset()
	PodStatusGauge.Reset()
	PodNetworkStatusGauge.Reset()
	PodSetsMultDomainIdGauge.Reset()
	PodRootPasswordFreshGauge.Reset()
}

// metricsBatch buffers gauge updates collected while a check is in progress, so they can be
// published in one fast, uninterrupted pass at the end (apply) instead of resetting the package's
// gauges up front and refilling them in place over the whole scan. The latter would let a
// concurrent Prometheus scrape land in the middle of a scan (which does real I/O — SQL connections
// per Pod, across every watched namespace — so it can take seconds) and observe an emptied-out or
// partially-refilled state: dashboards would show a periodic gap, and absent()-based alerts could
// fire spuriously. Buffering means the reset-and-refill pair below is pure in-memory work with
// nothing else in between, so a concurrent scrape sees at worst a tiny window instead of the whole
// scan's duration.
type metricsBatch struct {
	mu      sync.Mutex
	pending []pendingSet
}

type pendingSet struct {
	gauge  *prometheus.GaugeVec
	labels []string
	value  float64
}

func newMetricsBatch() *metricsBatch {
	return &metricsBatch{}
}

// set buffers a WithLabelValues(labels...).Set(value) call against gauge, to be applied later.
func (b *metricsBatch) set(gauge *prometheus.GaugeVec, value float64, labels ...string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.pending = append(b.pending, pendingSet{gauge: gauge, labels: labels, value: value})
}

// apply resets every gauge in this package and immediately repopulates them from the buffered
// values. Must only be called once a scan has fully completed; a scan that was aborted partway
// through (e.g. it ran out of its time budget — see Runnable.Start) must not call this, since
// publishing a partial result would incorrectly show the namespaces/CRs that weren't reached yet as
// gone rather than just stale.
func (b *metricsBatch) apply() {
	b.mu.Lock()
	defer b.mu.Unlock()
	resetAll()
	for _, p := range b.pending {
		p.gauge.WithLabelValues(p.labels...).Set(p.value)
	}
}
