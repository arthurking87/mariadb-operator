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
	// RootPasswordMaxAge is the age past which PodRootPasswordFreshGauge reports a root
	// password as stale. Defaults to DefaultRootPasswordMaxAge if zero.
	RootPasswordMaxAge time.Duration
	Logger             logr.Logger
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

	// Run once immediately rather than waiting for the first tick: time.NewTicker doesn't fire
	// until Interval has already elapsed, which would otherwise leave every gauge in this
	// package unpopulated for a full Interval right after the leader is elected (including
	// right after an operator restart).
	r.runCheck(ctx)

	ticker := time.NewTicker(r.Interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			r.runCheck(ctx)
		}
	}
}

// runCheck performs one full scan across every watched namespace and publishes the results,
// bounded to at most r.Interval: without this bound, a single stuck SQL dial (e.g. a Pod behind a
// network black hole) would hang the scan forever, on a context with no deadline of its own
// (Start's ctx lives for as long as this Runnable does). Critically, if the scan doesn't finish in
// time, its partial results are discarded instead of published — see metricsBatch's doc comment —
// so a stuck check leaves the previous tick's gauges in place (stale, but still reflecting the last
// known state) rather than looking like every CR disappeared.
func (r *Runnable) runCheck(ctx context.Context) {
	tickCtx, cancel := context.WithTimeout(ctx, r.Interval)
	defer cancel()

	rootPasswordMaxAge := r.RootPasswordMaxAge
	if rootPasswordMaxAge <= 0 {
		rootPasswordMaxAge = DefaultRootPasswordMaxAge
	}

	batch := newMetricsBatch()
	for _, ns := range r.Namespaces {
		r.Logger.Info("Schedule start checking", "namespace", ns)
		CheckCrds(tickCtx, r.Client, r.RefResolver, r.OperatorNamespace, r.OperatorName, ns, rootPasswordMaxAge, batch, r.Logger)
		r.Logger.Info("Schedule end checking", "namespace", ns)

		if err := tickCtx.Err(); err != nil {
			r.Logger.Error(err, "Scheduled check did not complete within the check interval; "+
				"keeping the previous tick's metrics instead of publishing a partial result")
			return
		}
	}
	batch.apply()
}
