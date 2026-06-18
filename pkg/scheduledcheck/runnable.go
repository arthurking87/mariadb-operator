package scheduledcheck

import (
	"context"
	"time"

	"github.com/go-logr/logr"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/refresolver"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/manager"
)

// compile-time interface assertions
var (
	_ manager.Runnable               = &Runnable{}
	_ manager.LeaderElectionRunnable = &Runnable{}
)

// Runnable periodically scans every watched namespace for MariaDB CRs and reports
// their health (CRD status, switchover state, conditions, Pod readiness, SQL
// reachability, GTID domain ID consistency and root password age) as Prometheus
// gauges. It is registered with the controller-runtime manager via mgr.Add, which
// runs it only on the elected leader and stops it when ctx is canceled.
type Runnable struct {
	Client            client.Client
	RefResolver       *refresolver.RefResolver
	Namespaces        []string
	OperatorNamespace string
	OperatorName      string
	Interval          time.Duration
	Logger            logr.Logger
}

func (r *Runnable) NeedLeaderElection() bool {
	return true
}

func (r *Runnable) Start(ctx context.Context) error {
	r.Logger.Info("Schedule check start",
		"watchNamespaces", r.Namespaces,
		"operatorName", r.OperatorName,
		"operatorNamespace", r.OperatorNamespace,
	)

	ticker := time.NewTicker(r.Interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			resetAll()
			for _, ns := range r.Namespaces {
				r.Logger.Info("Schedule start checking", "namespace", ns)
				CheckCrds(ctx, r.Client, r.RefResolver, r.OperatorNamespace, r.OperatorName, ns, r.Logger)
				r.Logger.Info("Schedule end checking", "namespace", ns)
			}
		}
	}
}
