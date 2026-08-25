package replication

import (
	"context"
	"net/http"
	"time"

	"github.com/go-logr/logr"
	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/agent/router"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/environment"
	mdbhttp "github.com/mariadb-operator/mariadb-operator/v26/pkg/http"
	mdbreplic "github.com/mariadb-operator/mariadb-operator/v26/pkg/replication"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/sql"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/utils/ptr"
	ctrlclient "sigs.k8s.io/controller-runtime/pkg/client"
)

type ReplicationProbe struct {
	mariadbKey      types.NamespacedName
	k8sClient       ctrlclient.Client
	env             *environment.PodEnvironment
	responseWriter  *mdbhttp.ResponseWriter
	livenessLogger  logr.Logger
	readinessLogger logr.Logger
}

var requestTimeout = 3 * time.Second

func NewReplicationProbe(env *environment.PodEnvironment, k8sClient ctrlclient.Client, responseWriter *mdbhttp.ResponseWriter,
	logger *logr.Logger) router.ProbeHandler {
	return &ReplicationProbe{
		mariadbKey: types.NamespacedName{
			Name:      env.MariadbName,
			Namespace: env.PodNamespace,
		},
		k8sClient:       k8sClient,
		env:             env,
		responseWriter:  responseWriter,
		livenessLogger:  logger.WithName("liveness"),
		readinessLogger: logger.WithName("readiness"),
	}
}

// resolveReplicaConnectionOpts determines which replication channel, if any, is currently
// configured as a replica connection on client: the named channel, or the legacy unnamed
// channel left over from before named channels were introduced (see
// sql.Client.MigrateLegacyReplicationChannel). Neither being configured is expected for
// primaries, so that case is reported as (nil, false, nil) rather than an error.
func resolveReplicaConnectionOpts(ctx context.Context, client *sql.Client) ([]sql.ReplicationOpt, bool, error) {
	namedOpts := []sql.ReplicationOpt{sql.WithConnectionName(mdbreplic.ReplicaConnectionName)}
	isReplica, err := client.IsReplicationReplica(ctx, namedOpts...)
	if err != nil && !sql.IsConnectionNotExists(err) {
		return nil, false, err
	}
	if isReplica {
		return namedOpts, true, nil
	}

	// The named channel isn't configured. Before assuming this node is a primary, check
	// whether it's still replicating on the legacy unnamed channel, e.g. because the
	// operator was just upgraded and this pod hasn't gone through migration yet.
	isLegacyReplica, err := client.IsReplicationReplica(ctx)
	if err != nil && !sql.IsConnectionNotExists(err) {
		return nil, false, err
	}
	return nil, isLegacyReplica, nil
}

func (p *ReplicationProbe) Liveness(w http.ResponseWriter, r *http.Request) {
	p.livenessLogger.V(1).Info("Probe started")

	sqlCtx, sqlCancel := context.WithTimeout(context.Background(), requestTimeout)
	defer sqlCancel()

	sqlClient, err := sql.NewLocalClientWithPodEnv(sqlCtx, p.env, sql.WithTimeout(requestTimeout))
	if err != nil {
		p.livenessLogger.Error(err, "error getting SQL client")
		p.responseWriter.WriteErrorf(w, "error getting SQL client: %v", err)
		return
	}
	defer sqlClient.Close()

	replOpts, isReplica, err := resolveReplicaConnectionOpts(sqlCtx, sqlClient)
	if err != nil {
		p.livenessLogger.Error(err, "error checking replica")
		p.responseWriter.WriteErrorf(w, "error checking replica: %v", err)
		return
	}
	if isReplica {
		status, err := sqlClient.ReplicaStatus(sqlCtx, p.livenessLogger, replOpts...)
		if err != nil {
			p.livenessLogger.Error(err, "error getting replica status")
			p.responseWriter.WriteErrorf(w, "error getting replica status: %v", err)
			return
		}

		replicaIORunning := ptr.Deref(status.SlaveIORunning, false)
		if !replicaIORunning {
			p.livenessLogger.Error(nil, "Replica IO thread not running")
			p.responseWriter.WriteError(w, "Replica IO thread not running")
			return
		}
		replicaSQLRunning := ptr.Deref(status.SlaveSQLRunning, false)
		if !replicaSQLRunning {
			p.livenessLogger.Error(nil, "Replica SQL thread not running")
			p.responseWriter.WriteError(w, "Replica SQL thread not running")
			return
		}

		p.livenessLogger.V(1).Info(
			"Replica thread running status",
			"Slave_IO_Running", replicaIORunning,
			"Slave_SQL_Running", replicaSQLRunning,
		)
		p.responseWriter.WriteOK(w, nil)
		return
	}

	isPrimary, err := sqlClient.IsReplicationPrimary(sqlCtx)
	if err != nil {
		p.livenessLogger.Error(err, "error checking primary")
		p.responseWriter.WriteErrorf(w, "error checking primary: %v", err)
		return
	}
	if !isPrimary {
		p.livenessLogger.Error(nil, "Primary not configured")
		p.responseWriter.WriteError(w, "Primary not configured")
		return
	}

	p.responseWriter.WriteOK(w, nil)
}

func (p *ReplicationProbe) Readiness(w http.ResponseWriter, r *http.Request) {
	p.readinessLogger.V(1).Info("Probe started")

	sqlCtx, sqlCancel := context.WithTimeout(context.Background(), requestTimeout)
	defer sqlCancel()

	k8sCtx, k8sCancel := context.WithTimeout(context.Background(), requestTimeout)
	defer k8sCancel()

	sqlClient, err := sql.NewLocalClientWithPodEnv(sqlCtx, p.env, sql.WithTimeout(requestTimeout))
	if err != nil {
		p.readinessLogger.Error(err, "error getting SQL client")
		p.responseWriter.WriteErrorf(w, "error getting SQL client: %v", err)
		return
	}
	defer sqlClient.Close()

	replOpts, isReplica, err := resolveReplicaConnectionOpts(sqlCtx, sqlClient)
	if err != nil {
		p.readinessLogger.Error(err, "error checking replica")
		p.responseWriter.WriteErrorf(w, "error checking replica: %v", err)
		return
	}
	if isReplica {
		status, err := sqlClient.ReplicaStatus(sqlCtx, p.readinessLogger, replOpts...)
		if err != nil {
			p.readinessLogger.Error(err, "error getting replica status")
			p.responseWriter.WriteErrorf(w, "error getting replica status: %v", err)
			return
		}
		if status.SecondsBehindMaster == nil {
			p.readinessLogger.Error(nil, "could not determine replica lag")
			p.responseWriter.WriteError(w, "could not determine replica lag")
			return
		}
		secondsBehindMaster := *status.SecondsBehindMaster

		maxLagSeconds := p.getMaxLagSeconds(k8sCtx)
		if secondsBehindMaster > maxLagSeconds {
			p.readinessLogger.Error(nil, "Replica is lagging behind master", "seconds", secondsBehindMaster, "max-seconds", maxLagSeconds)
			p.responseWriter.WriteErrorf(w, "Replica is lagging %d seconds behind master (max seconds: %d)", secondsBehindMaster, maxLagSeconds)
			return
		}

		p.readinessLogger.V(1).Info(
			"Replica lag status",
			"seconds", secondsBehindMaster,
			"max-seconds", maxLagSeconds,
		)
		p.responseWriter.WriteOK(w, nil)
		return
	}

	isPrimary, err := sqlClient.IsReplicationPrimary(sqlCtx)
	if err != nil {
		p.readinessLogger.Error(err, "error checking primary")
		p.responseWriter.WriteErrorf(w, "error checking primary: %v", err)
		return
	}
	if !isPrimary {
		p.readinessLogger.Error(nil, "Primary not configured")
		p.responseWriter.WriteError(w, "Primary not configured")
		return
	}

	p.responseWriter.WriteOK(w, nil)
}

func (p *ReplicationProbe) getMaxLagSeconds(ctx context.Context) int {
	var mdb mariadbv1alpha1.MariaDB
	if err := p.k8sClient.Get(ctx, p.mariadbKey, &mdb); err != nil {
		p.readinessLogger.Error(err, "error getting MariaDB. Using default max replication lag")
		return 0
	}
	replication := ptr.Deref(mdb.Spec.Replication, mariadbv1alpha1.Replication{})
	replica := replication.Replica
	return ptr.Deref(replica.MaxLagSeconds, 0)
}
