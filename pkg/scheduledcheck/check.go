package scheduledcheck

import (
	"context"
	"encoding/json"
	"errors"
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

// DefaultRootPasswordMaxAge is the default value for CheckCrds' rootPasswordMaxAge parameter,
// used when the operator isn't started with a different --root-password-max-age.
const DefaultRootPasswordMaxAge = 90 * 24 * time.Hour

// Bounded set of "error" label values for PodRootPasswordFreshGauge, for the same reason
// PodNetworkStatusGauge's error label is bounded (see classifyError).
const (
	errCategoryQueryFailed  = "query_failed"
	errCategoryInvalidJSON  = "invalid_json"
	errCategoryInvalidValue = "invalid_value"
)

// CheckCrds checks every MariaDB CR in namespace (or every namespace the operator
// watches, if namespace is empty) and buffers the results into batch (see metricsBatch).
func CheckCrds(ctx context.Context, c client.Client, refResolver *refresolver.RefResolver,
	operatorNamespace, operatorName, namespace string, rootPasswordMaxAge time.Duration, batch *metricsBatch, logger logr.Logger) {
	var mariadbList mariadbv1alpha1.MariaDBList
	if err := c.List(ctx, &mariadbList, client.InNamespace(namespace)); err != nil {
		logger.Error(err, "Unable to list MariaDB CRs", "namespace", namespace)
		return
	}
	for i := range mariadbList.Items {
		checkMariaDB(ctx, c, refResolver, operatorNamespace, operatorName, &mariadbList.Items[i], rootPasswordMaxAge, batch, logger)
	}
}

func checkMariaDB(ctx context.Context, c client.Client, refResolver *refresolver.RefResolver,
	operatorNamespace, operatorName string, mdb *mariadbv1alpha1.MariaDB, rootPasswordMaxAge time.Duration,
	batch *metricsBatch, logger logr.Logger) {
	ns, name := mdb.Namespace, mdb.Name

	batch.set(MariadbReadyGauge, boolToFloat(mdb.IsReady()), operatorNamespace, operatorName, ns, name)
	batch.set(MariadbSwitchoverStatusGauge, boolToFloat(mdb.IsSwitchingPrimary()), operatorNamespace, operatorName, ns, name)

	for _, cond := range mdb.Status.Conditions {
		batch.set(MariadbStatusSingleConditionGauge, conditionStatusToFloat(cond.Status),
			operatorNamespace, operatorName, ns, name, cond.Type, cond.Reason)
	}

	checkPods(ctx, c, refResolver, operatorNamespace, operatorName, mdb, rootPasswordMaxAge, batch, logger)
}

func checkPods(ctx context.Context, c client.Client, refResolver *refresolver.RefResolver,
	operatorNamespace, operatorName string, mdb *mariadbv1alpha1.MariaDB, rootPasswordMaxAge time.Duration,
	batch *metricsBatch, logger logr.Logger) {
	ns, name := mdb.Namespace, mdb.Name

	pods, err := mdbpod.ListMariaDBPods(ctx, c, mdb)
	if err != nil {
		logger.Error(err, "Unable to list MariaDB Pods", "namespace", ns, "mariadb", name)
		return
	}
	for i := range pods {
		batch.set(PodStatusGauge, boolToFloat(mdbpod.PodReady(&pods[i])), operatorNamespace, operatorName, ns, name, pods[i].Name)
	}

	clientSet := mariadbsql.NewClientSet(mdb, refResolver)
	defer clientSet.Close()

	domainIDs := make(map[uint32]struct{})
	for i, result := range clientSet.Clients(ctx) {
		podName := statefulset.PodName(mdb.ObjectMeta, i)

		if result.Err != nil {
			logger.Error(result.Err, "Unable to open SQL connection", "namespace", ns, "mariadb", name, "pod", podName)
			batch.set(PodNetworkStatusGauge, 0, operatorNamespace, operatorName, ns, name, podName, classifyError(result.Err))
			continue
		}
		batch.set(PodNetworkStatusGauge, 1, operatorNamespace, operatorName, ns, name, podName, "")

		if domainID, err := result.Client.GtidDomainId(ctx); err != nil {
			logger.Error(err, "Unable to get gtid_domain_id", "namespace", ns, "mariadb", name, "pod", podName)
		} else if domainID != nil {
			domainIDs[*domainID] = struct{}{}
		}

		checkRootPasswordAge(ctx, result.Client, operatorNamespace, operatorName, ns, name, podName, rootPasswordMaxAge, batch, logger)
	}

	batch.set(PodSetsMultDomainIdGauge, boolToFloat(len(domainIDs) > 1),
		operatorNamespace, operatorName, ns, name, domainIDsLabel(domainIDs))
}

// errPasswordLastChangedAbsent is returned by parseUnixTimestamp when the
// password_last_changed field isn't present at all, which is expected (not an error) for
// accounts using an auth plugin other than the password-based one, e.g. unix_socket for
// root@localhost.
var errPasswordLastChangedAbsent = errors.New("password_last_changed field is absent")

// checkRootPasswordAge reads MariaDB's own bookkeeping of root password age
// (mysql.global_priv.Priv->>'$.password_last_changed', a Unix timestamp MariaDB
// updates on every password change) rather than tracking it in operator state,
// since the operator currently has no field for it and this is authoritative anyway.
func checkRootPasswordAge(ctx context.Context, sqlClient *mariadbsql.Client,
	operatorNamespace, operatorName, namespace, mariadbName, podName string, rootPasswordMaxAge time.Duration,
	batch *metricsBatch, logger logr.Logger) {
	rows, err := sqlClient.QueryColumnMaps(ctx, "SELECT Host, User, Priv FROM mysql.global_priv WHERE User = 'root'")
	if err != nil {
		logger.Error(err, "Unable to query mysql.global_priv", "namespace", namespace, "mariadb", mariadbName, "pod", podName)
		batch.set(PodRootPasswordFreshGauge, 0,
			operatorNamespace, operatorName, namespace, mariadbName, podName, "", "", errCategoryQueryFailed)
		return
	}

	for _, row := range rows {
		host, user := row["Host"], row["User"]

		var priv map[string]any
		if err := json.Unmarshal([]byte(row["Priv"]), &priv); err != nil {
			logger.Error(err, "Unable to parse mysql.global_priv.Priv", "namespace", namespace, "mariadb", mariadbName, "pod", podName)
			batch.set(PodRootPasswordFreshGauge, 0,
				operatorNamespace, operatorName, namespace, mariadbName, podName, host, user, errCategoryInvalidJSON)
			continue
		}

		lastChanged, err := parseUnixTimestamp(priv["password_last_changed"])
		if err != nil {
			if errors.Is(err, errPasswordLastChangedAbsent) {
				// Expected for non-password auth plugins (e.g. unix_socket) — not a failure,
				// so skip emitting a series for this account instead of reporting it as stale.
				logger.V(1).Info("password_last_changed absent, skipping root password age check",
					"namespace", namespace, "mariadb", mariadbName, "pod", podName, "host", host, "user", user)
				continue
			}
			logger.Error(err, "Unable to parse password_last_changed", "namespace", namespace, "mariadb", mariadbName, "pod", podName)
			batch.set(PodRootPasswordFreshGauge, 0,
				operatorNamespace, operatorName, namespace, mariadbName, podName, host, user, errCategoryInvalidValue)
			continue
		}

		fresh := time.Since(time.Unix(lastChanged, 0)) <= rootPasswordMaxAge
		batch.set(PodRootPasswordFreshGauge, boolToFloat(fresh),
			operatorNamespace, operatorName, namespace, mariadbName, podName, host, user, "")
	}
}

func parseUnixTimestamp(v any) (int64, error) {
	if v == nil {
		return 0, errPasswordLastChangedAbsent
	}
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
