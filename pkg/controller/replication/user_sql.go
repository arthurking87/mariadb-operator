package replication

import (
	"context"
	"errors"
	"fmt"

	"github.com/go-logr/logr"
	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/refresolver"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/sql"
	"k8s.io/utils/ptr"
)

var (
	replUser           = "repl"
	replUserHost       = "%"
	replUserPrivileges = []string{"REPLICATION REPLICA"}
)

type userSqlReconciler struct {
	mariadb     *mariadbv1alpha1.MariaDB
	refResolver *refresolver.RefResolver
	logger      logr.Logger
}

func newUserSqlReconciler(mariadb *mariadbv1alpha1.MariaDB, refResolver *refresolver.RefResolver, logger logr.Logger) *userSqlReconciler {
	return &userSqlReconciler{
		mariadb:     mariadb,
		refResolver: refResolver,
		logger:      logger,
	}
}

type userSqlOpts struct {
	username             string
	passwordSecretKeyRef mariadbv1alpha1.SecretKeySelector
	host                 string
	privileges           []string
}

// reconcileReplUserSql (re)creates the repl user and grants it the required privileges. skipBinlog
// must only be true when the caller already knows the primary's gtid_binlog_pos/gtid_slave_pos are
// established (i.e. this isn't the first write after a replica-to-primary promotion): a freshly
// promoted primary has just had its gtid_slave_pos reset and relies on this being its first
// binlogged write to seed a non-empty GTID position, which switchover/failover need immediately
// afterwards to reconnect the remaining replicas.
func (r *userSqlReconciler) reconcileReplUserSql(ctx context.Context, client *sql.Client, skipBinlog bool) error {
	r.logger.V(1).Info("Reconciling repl user")
	opts, err := r.newReplUserOpts()
	if err != nil {
		return fmt.Errorf("error getting repl user options: %v", err)
	}

	replPassword, err := r.refResolver.SecretKeyRef(ctx, opts.passwordSecretKeyRef, r.mariadb.Namespace)
	if err != nil {
		return fmt.Errorf("error getting repl password: %v", err)
	}
	accountName := formatAccountName(opts.username, opts.host)

	exists, err := client.UserExists(ctx, opts.username, opts.host)
	if err != nil {
		return fmt.Errorf("error checking if replication user exists: %v", err)
	}

	reconcile := func(client *sql.Client) error {
		if exists {
			if err := client.AlterUser(ctx, accountName, sql.WithIdentifiedBy(replPassword)); err != nil {
				return fmt.Errorf("error altering replication user: %v", err)
			}
		} else {
			if err := client.CreateUser(ctx, accountName, sql.WithIdentifiedBy(replPassword)); err != nil {
				return fmt.Errorf("error creating replication user: %v", err)
			}
		}
		if err := client.Grant(
			ctx,
			opts.privileges,
			"*",
			"*",
			accountName,
		); err != nil {
			return fmt.Errorf("error creating grant: %v", err)
		}
		return nil
	}

	if !skipBinlog {
		return reconcile(client)
	}
	// Every member reconciles its own repl user independently as soon as it becomes primary, so
	// there's no need to replicate this bookkeeping to other members. Skipping the binlog for it
	// avoids waiting on a semi-sync ACK here, which would otherwise stall this exact statement
	// right when replication may still be establishing between members.
	return client.WithoutBinlog(ctx, reconcile)
}

func (r *userSqlReconciler) newReplUserOpts() (*userSqlOpts, error) {
	opts := userSqlOpts{
		username:   replUser,
		host:       replUserHost,
		privileges: replUserPrivileges,
	}
	if r.mariadb.IsReplicationEnabled() {
		replication := ptr.Deref(r.mariadb.Spec.Replication, mariadbv1alpha1.Replication{})
		if replication.Replica.ReplPasswordSecretKeyRef == nil {
			return nil, errors.New("'spec.replication.replica.replPasswordSecretKeyRef' must not be nil")
		}
		opts.passwordSecretKeyRef = replication.Replica.ReplPasswordSecretKeyRef.SecretKeySelector
	} else if r.mariadb.IsGaleraEnabled() {
		galera := ptr.Deref(r.mariadb.Spec.Galera, mariadbv1alpha1.Galera{})
		if galera.ReplPasswordSecretKeyRef == nil {
			return nil, errors.New("'spec.galera.replPasswordSecretKeyRef' must not be nil")
		}
		opts.passwordSecretKeyRef = galera.ReplPasswordSecretKeyRef.SecretKeySelector
	}
	return &opts, nil
}
