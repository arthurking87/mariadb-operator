package scheduledcheck

import (
	"github.com/prometheus/client_golang/prometheus"
	ctrlmetrics "sigs.k8s.io/controller-runtime/pkg/metrics"
)

// All gauges share the same identity labels (operator_namespace, operator_name,
// namespace, name) so they can be joined/filtered consistently in Grafana/PromQL,
// plus whatever extra labels each check needs.
var (
	// CrdStatus_Gauge reports whether a MariaDB CR is Ready (1) or not (0).
	CrdStatus_Gauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "mariadb_operator_crd_status",
			Help: "Whether a MariaDB CR is Ready (1) or not (0).",
		},
		[]string{"operator_namespace", "operator_name", "namespace", "name"},
	)

	// MariadbSwitchoverStatus_Gauge reports whether a MariaDB primary switchover is
	// currently in progress (1) or not (0).
	MariadbSwitchoverStatus_Gauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "mariadb_operator_mariadb_switchover_status",
			Help: "Whether a MariaDB primary switchover is currently in progress (1) or not (0).",
		},
		[]string{"operator_namespace", "operator_name", "namespace", "name"},
	)

	// MariadbStatusSingleCondition_Gauge reports the status of each individual
	// condition on a MariaDB CR: 1=True, 0=False, -1=Unknown.
	MariadbStatusSingleCondition_Gauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "mariadb_operator_mariadb_condition_status",
			Help: "Status of each MariaDB condition. 1=True, 0=False, -1=Unknown.",
		},
		[]string{"operator_namespace", "operator_name", "namespace", "name", "condition", "reason"},
	)

	// PodStatus_Gauge reports whether a MariaDB Pod is Ready (1) or not (0).
	PodStatus_Gauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "mariadb_operator_pod_status",
			Help: "Whether a MariaDB Pod is Ready (1) or not (0).",
		},
		[]string{"operator_namespace", "operator_name", "namespace", "name", "pod"},
	)

	// PodNetworkStatus_Gauge reports whether the operator could open a SQL connection
	// to a Pod's MariaDB port (1) or not (0).
	PodNetworkStatus_Gauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "mariadb_operator_pod_network_status",
			Help: "Whether the operator could open a SQL connection to a Pod (1) or not (0).",
		},
		[]string{"operator_namespace", "operator_name", "namespace", "name", "pod", "error"},
	)

	// PodSetsMultDomainId_Gauge reports whether the Pods of a MariaDB report more than
	// one distinct gtid_domain_id (1=inconsistent, 0=consistent).
	PodSetsMultDomainId_Gauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "mariadb_operator_pod_sets_multi_domain_id",
			Help: "Whether the Pods of a MariaDB report more than one distinct gtid_domain_id (1=inconsistent, 0=consistent).",
		},
		[]string{"operator_namespace", "operator_name", "namespace", "name", "domain_ids"},
	)

	// PodSetsRootPasswordLastChangeGreaterThan90Day_Gauge reports, per Pod and per
	// root@host account found in mysql.global_priv, whether the password was changed
	// within the last 90 days (1=ok) or not / check failed (0).
	PodSetsRootPasswordLastChangeGreaterThan90Day_Gauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "mariadb_operator_pod_root_password_changed_within_90day",
			Help: "Whether the root password was changed within the last 90 days (1=ok, 0=stale or check failed).",
		},
		[]string{"operator_namespace", "operator_name", "namespace", "name", "pod", "host", "user", "error"},
	)
)

func init() {
	ctrlmetrics.Registry.MustRegister(
		CrdStatus_Gauge,
		MariadbSwitchoverStatus_Gauge,
		MariadbStatusSingleCondition_Gauge,
		PodStatus_Gauge,
		PodNetworkStatus_Gauge,
		PodSetsMultDomainId_Gauge,
		PodSetsRootPasswordLastChangeGreaterThan90Day_Gauge,
	)
}

// resetAll clears every series of every gauge in this package. It is called at the
// start of each scheduled check so that CRs/Pods that disappeared between ticks don't
// leave stale series behind (the same staleness problem as in pkg/metrics, but here
// solved by a full reset since every tick recomputes the whole world from scratch).
func resetAll() {
	CrdStatus_Gauge.Reset()
	MariadbSwitchoverStatus_Gauge.Reset()
	MariadbStatusSingleCondition_Gauge.Reset()
	PodStatus_Gauge.Reset()
	PodNetworkStatus_Gauge.Reset()
	PodSetsMultDomainId_Gauge.Reset()
	PodSetsRootPasswordLastChangeGreaterThan90Day_Gauge.Reset()
}
