package scheduledcheck

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-logr/logr"
	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	mdbpod "github.com/mariadb-operator/mariadb-operator/v26/pkg/pod"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/refresolver"
	mariadbsql "github.com/mariadb-operator/mariadb-operator/v26/pkg/sql"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/statefulset"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

const rootPasswordMaxAge = 90 * 24 * time.Hour

// CheckCrds checks every MariaDB CR in namespace (or every namespace the operator
// watches, if namespace is empty) and records the results into the package gauges.
func CheckCrds(ctx context.Context, c client.Client, refResolver *refresolver.RefResolver,
	operatorNamespace, operatorName, namespace string, logger logr.Logger) {
	var mariadbList mariadbv1alpha1.MariaDBList
	if err := c.List(ctx, &mariadbList, client.InNamespace(namespace)); err != nil {
		logger.Error(err, "Unable to list MariaDB CRs", "namespace", namespace)
		return
	}
	for i := range mariadbList.Items {
		checkMariaDB(ctx, c, refResolver, operatorNamespace, operatorName, &mariadbList.Items[i], logger)
	}
}

func checkMariaDB(ctx context.Context, c client.Client, refResolver *refresolver.RefResolver,
	operatorNamespace, operatorName string, mdb *mariadbv1alpha1.MariaDB, logger logr.Logger) {
	ns, name := mdb.Namespace, mdb.Name

	CrdStatus_Gauge.WithLabelValues(operatorNamespace, operatorName, ns, name).Set(boolToFloat(mdb.IsReady()))
	MariadbSwitchoverStatus_Gauge.WithLabelValues(operatorNamespace, operatorName, ns, name).
		Set(boolToFloat(mdb.IsSwitchingPrimary()))

	for _, cond := range mdb.Status.Conditions {
		MariadbStatusSingleCondition_Gauge.
			WithLabelValues(operatorNamespace, operatorName, ns, name, cond.Type, cond.Reason).
			Set(conditionStatusToFloat(cond.Status))
	}

	checkPods(ctx, c, refResolver, operatorNamespace, operatorName, mdb, logger)
}

func checkPods(ctx context.Context, c client.Client, refResolver *refresolver.RefResolver,
	operatorNamespace, operatorName string, mdb *mariadbv1alpha1.MariaDB, logger logr.Logger) {
	ns, name := mdb.Namespace, mdb.Name

	pods, err := mdbpod.ListMariaDBPods(ctx, c, mdb)
	if err != nil {
		logger.Error(err, "Unable to list MariaDB Pods", "namespace", ns, "mariadb", name)
		return
	}
	for i := range pods {
		PodStatus_Gauge.WithLabelValues(operatorNamespace, operatorName, ns, name, pods[i].Name).
			Set(boolToFloat(mdbpod.PodReady(&pods[i])))
	}

	clientSet := mariadbsql.NewClientSet(mdb, refResolver)
	defer clientSet.Close()

	domainIDs := make(map[uint32]struct{})
	for i, result := range clientSet.Clients(ctx) {
		podName := statefulset.PodName(mdb.ObjectMeta, i)

		if result.Err != nil {
			PodNetworkStatus_Gauge.WithLabelValues(operatorNamespace, operatorName, ns, name, podName, result.Err.Error()).Set(0)
			continue
		}
		PodNetworkStatus_Gauge.WithLabelValues(operatorNamespace, operatorName, ns, name, podName, "").Set(1)

		if domainID, err := result.Client.GtidDomainId(ctx); err != nil {
			logger.Error(err, "Unable to get gtid_domain_id", "namespace", ns, "mariadb", name, "pod", podName)
		} else if domainID != nil {
			domainIDs[*domainID] = struct{}{}
		}

		checkRootPasswordAge(ctx, result.Client, operatorNamespace, operatorName, ns, name, podName, logger)
	}

	PodSetsMultDomainId_Gauge.WithLabelValues(operatorNamespace, operatorName, ns, name, domainIDsLabel(domainIDs)).
		Set(boolToFloat(len(domainIDs) > 1))
}

// checkRootPasswordAge reads MariaDB's own bookkeeping of root password age
// (mysql.global_priv.Priv->>'$.password_last_changed', a Unix timestamp MariaDB
// updates on every password change) rather than tracking it in operator state,
// since the operator currently has no field for it and this is authoritative anyway.
func checkRootPasswordAge(ctx context.Context, sqlClient *mariadbsql.Client,
	operatorNamespace, operatorName, namespace, mariadbName, podName string, logger logr.Logger) {
	rows, err := sqlClient.QueryColumnMaps(ctx, "SELECT Host, User, Priv FROM mysql.global_priv WHERE User = 'root'")
	if err != nil {
		logger.Error(err, "Unable to query mysql.global_priv", "namespace", namespace, "mariadb", mariadbName, "pod", podName)
		PodSetsRootPasswordLastChangeGreaterThan90Day_Gauge.
			WithLabelValues(operatorNamespace, operatorName, namespace, mariadbName, podName, "", "", err.Error()).
			Set(0)
		return
	}

	for _, row := range rows {
		host, user := row["Host"], row["User"]

		var priv map[string]any
		if err := json.Unmarshal([]byte(row["Priv"]), &priv); err != nil {
			PodSetsRootPasswordLastChangeGreaterThan90Day_Gauge.
				WithLabelValues(operatorNamespace, operatorName, namespace, mariadbName, podName, host, user, err.Error()).
				Set(0)
			continue
		}

		lastChanged, err := parseUnixTimestamp(priv["password_last_changed"])
		if err != nil {
			PodSetsRootPasswordLastChangeGreaterThan90Day_Gauge.
				WithLabelValues(operatorNamespace, operatorName, namespace, mariadbName, podName, host, user, err.Error()).
				Set(0)
			continue
		}

		withinRange := time.Since(time.Unix(lastChanged, 0)) <= rootPasswordMaxAge
		PodSetsRootPasswordLastChangeGreaterThan90Day_Gauge.
			WithLabelValues(operatorNamespace, operatorName, namespace, mariadbName, podName, host, user, "").
			Set(boolToFloat(withinRange))
	}
}

func parseUnixTimestamp(v any) (int64, error) {
	return strconv.ParseInt(fmt.Sprintf("%.0f", v), 10, 64)
}

func domainIDsLabel(domainIDs map[uint32]struct{}) string {
	ids := make([]string, 0, len(domainIDs))
	for id := range domainIDs {
		ids = append(ids, strconv.FormatUint(uint64(id), 10))
	}
	sort.Strings(ids)
	return strings.Join(ids, ",")
}

func boolToFloat(b bool) float64 {
	if b {
		return 1
	}
	return 0
}

func conditionStatusToFloat(status metav1.ConditionStatus) float64 {
	switch status {
	case metav1.ConditionTrue:
		return 1
	case metav1.ConditionFalse:
		return 0
	default:
		return -1
	}
}
