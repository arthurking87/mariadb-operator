package replication

import (
	"context"
	stddb "database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"

	"github.com/go-logr/logr"
	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/refresolver"
	sqlClient "github.com/mariadb-operator/mariadb-operator/v26/pkg/sql"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

// recordingConn is a minimal driver.Conn that records every Exec statement and fails
// (with a configurable error) whenever an Exec statement contains failExecContains.
// Every Query returns a generic single-row result set, which is enough for the
// IsReplicationReplica boolean-existence check and any other Query-based lookups
// performed while configuring the primary.
type recordingConn struct {
	mu               sync.Mutex
	execs            []string
	failExecContains string
	failErr          error
}

func (c *recordingConn) Prepare(query string) (driver.Stmt, error) {
	return nil, errors.New("not supported")
}
func (c *recordingConn) Close() error              { return nil }
func (c *recordingConn) Begin() (driver.Tx, error) { return nil, errors.New("not supported") }

func (c *recordingConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.mu.Lock()
	c.execs = append(c.execs, query)
	c.mu.Unlock()
	if c.failExecContains != "" && strings.Contains(query, c.failExecContains) {
		return nil, c.failErr
	}
	return driver.RowsAffected(0), nil
}

func (c *recordingConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	return &oneRowRows{}, nil
}

func (c *recordingConn) recordedExecs() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.execs...)
}

// oneRowRows always yields a single row with a single column, which is sufficient for
// callers that only check whether a query returned any rows (e.g. IsReplicationReplica)
// or scan a single value out of it (e.g. UserExists' COUNT(*)).
type oneRowRows struct{ done bool }

func (r *oneRowRows) Columns() []string { return []string{"1"} }
func (r *oneRowRows) Close() error      { return nil }
func (r *oneRowRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	dest[0] = "1"
	return nil
}

type recordingDriver struct{}

func (recordingDriver) Open(name string) (driver.Conn, error) {
	return nil, errors.New("use connector")
}

type recordingConnector struct{ conn *recordingConn }

func (c *recordingConnector) Connect(ctx context.Context) (driver.Conn, error) { return c.conn, nil }
func (c *recordingConnector) Driver() driver.Driver                            { return recordingDriver{} }

// newTestSingleClusterTopology builds a singleClusterTopology backed by a fake Kubernetes
// client seeded with the replication password Secret, mirroring what reconcileReplUserSql
// needs to resolve via the RefResolver.
func newTestSingleClusterTopology(t *testing.T) (*singleClusterTopology, *mariadbv1alpha1.MariaDB) {
	t.Helper()

	scheme := runtime.NewScheme()
	utilruntime.Must(clientgoscheme.AddToScheme(scheme))
	utilruntime.Must(mariadbv1alpha1.AddToScheme(scheme))

	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "repl-password",
			Namespace: "default",
		},
		Data: map[string][]byte{
			"password": []byte("test-password"),
		},
	}

	mariadb := &mariadbv1alpha1.MariaDB{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "mariadb-test",
			Namespace: "default",
		},
		Spec: mariadbv1alpha1.MariaDBSpec{
			Replication: &mariadbv1alpha1.Replication{
				Enabled: true,
				ReplicationSpec: mariadbv1alpha1.ReplicationSpec{
					Replica: mariadbv1alpha1.ReplicaReplication{
						ReplPasswordSecretKeyRef: &mariadbv1alpha1.GeneratedSecretKeyRef{
							SecretKeySelector: mariadbv1alpha1.SecretKeySelector{
								LocalObjectReference: mariadbv1alpha1.LocalObjectReference{
									Name: "repl-password",
								},
								Key: "password",
							},
						},
					},
				},
			},
		},
	}

	k8sClient := fake.NewClientBuilder().WithScheme(scheme).WithObjects(secret).Build()
	refResolver := refresolver.New(k8sClient)
	logger := logr.Discard()
	userSqlReconciler := newUserSqlReconciler(mariadb, refResolver, logger)

	topology := newSingleClusterTopology(mariadb, userSqlReconciler, k8sClient, refResolver, logger)
	return topology, mariadb
}

// TestConfigurePrimary_DisablesReadOnlyAfterGtidSlavePosNoValueForDomainError is a regression
// test for the switchover bug fixed in pkg/controller/replication/topology.go: when
// ResetGtidSlavePos fails with Error 1948 (no value for replication domain, a legitimate
// condition in multi-cluster/PITR setups), ConfigurePrimary must swallow that specific error
// and still proceed to DisableReadOnly, instead of returning early and leaving the newly
// promoted primary stuck in READ_ONLY=ON.
func TestConfigurePrimary_DisablesReadOnlyAfterGtidSlavePosNoValueForDomainError(t *testing.T) {
	topology, _ := newTestSingleClusterTopology(t)

	conn := &recordingConn{
		failExecContains: "gtid_slave_pos",
		failErr: errors.New("Error 1948 (HY000): Specified value for @@gtid_slave_pos contains no value for " +
			"replication domain 0. This conflicts with the binary log which contains GTID 0-11-1176. If " +
			"MASTER_GTID_POS=CURRENT_POS is used, the binlog position will override the new value of @@gtid_slave_pos"),
	}
	db := stddb.OpenDB(&recordingConnector{conn: conn})
	defer db.Close()
	client := sqlClient.NewClientFromDB(db)

	err := topology.ConfigurePrimary(context.Background(), client)
	if err != nil {
		t.Fatalf("expected no error (1948 must be swallowed), got: %v", err)
	}

	execs := conn.recordedExecs()
	found := false
	for _, e := range execs {
		if strings.Contains(e, "read_only=0") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected DisableReadOnly (read_only=0) to have run despite the GTID 1948 error, recorded execs: %v", execs)
	}
}
