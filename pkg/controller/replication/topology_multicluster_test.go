package replication

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
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
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

// recordingConn is a minimal database/sql/driver.Conn that records every executed
// statement instead of talking to a real MariaDB server. It also answers queries
// (e.g. the "does this user exist" check performed while reconciling the repl user)
// so that the full configurePrimaryReplica flow can run end-to-end in a unit test.
type recordingConn struct {
	mu    sync.Mutex
	execs []string
	// execErr, when non-nil, is consulted for every executed statement and lets a
	// test simulate a specific SQL error (e.g. "no such master connection") for a
	// given query, while leaving every other statement to succeed.
	execErr func(query string) error
}

func (c *recordingConn) Prepare(query string) (driver.Stmt, error) {
	return nil, errors.New("recordingConn: Prepare not supported, use ExecContext/QueryContext")
}

func (c *recordingConn) Close() error { return nil }

func (c *recordingConn) Begin() (driver.Tx, error) {
	return nil, errors.New("recordingConn: Begin not supported")
}

func (c *recordingConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.mu.Lock()
	c.execs = append(c.execs, query)
	execErr := c.execErr
	c.mu.Unlock()

	if execErr != nil {
		if err := execErr(query); err != nil {
			return nil, err
		}
	}
	return driver.RowsAffected(0), nil
}

// QueryContext always reports zero matching rows (e.g. "SELECT COUNT(*) ... = 0"),
// which is enough for the repl user reconciliation performed as part of
// configurePrimaryReplica (it takes the "user does not exist yet" branch).
func (c *recordingConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	return &singleIntRow{value: 0}, nil
}

func (c *recordingConn) execsSnapshot() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.execs...)
}

// singleIntRow is a driver.Rows implementation yielding a single row with a single
// integer column, mimicking "SELECT COUNT(*) FROM mysql.user WHERE ...".
type singleIntRow struct {
	value int64
	done  bool
}

func (r *singleIntRow) Columns() []string { return []string{"count"} }
func (r *singleIntRow) Close() error      { return nil }
func (r *singleIntRow) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	dest[0] = r.value
	r.done = true
	return nil
}

type recordingDriver struct{}

func (recordingDriver) Open(name string) (driver.Conn, error) {
	return nil, errors.New("recordingDriver: Open not supported, use recordingConnector")
}

type recordingConnector struct {
	conn *recordingConn
}

func (c *recordingConnector) Connect(ctx context.Context) (driver.Conn, error) {
	return c.conn, nil
}

func (c *recordingConnector) Driver() driver.Driver {
	return recordingDriver{}
}

// newRecordingSQLClient builds a *sqlClient.Client backed by a recordingConn, so that
// every statement configurePrimaryReplica issues can be inspected without a live
// MariaDB connection.
func newRecordingSQLClient(conn *recordingConn) *sqlClient.Client {
	db := sql.OpenDB(&recordingConnector{conn: conn})
	return sqlClient.NewClientFromDB(db)
}

const (
	testNamespace           = "test"
	testReplicaClusterName  = "mariadb-replica"
	testPrimaryClusterName  = "mariadb-primary"
	testReplPasswordSecret  = "repl-password"
	testExternalMariaDBName = "external-primary"
	testExternalPassSecret  = "external-password"
)

// newMultiClusterReplicaTestTopology builds a multiClusterTopology for a MariaDB that
// is a replica cluster in a multi-cluster topology, along with a fake Kubernetes client
// pre-populated with the Secrets and ExternalMariaDB referenced by that MariaDB. This is
// the minimal setup required for configurePrimaryReplica to run end-to-end.
func newMultiClusterReplicaTestTopology(t *testing.T) *multiClusterTopology {
	t.Helper()

	mdb := &mariadbv1alpha1.MariaDB{
		ObjectMeta: metav1.ObjectMeta{
			Name:      testReplicaClusterName,
			Namespace: testNamespace,
		},
		Spec: mariadbv1alpha1.MariaDBSpec{
			Replication: &mariadbv1alpha1.Replication{
				Enabled: true,
				ReplicationSpec: mariadbv1alpha1.ReplicationSpec{
					Replica: mariadbv1alpha1.ReplicaReplication{
						ReplPasswordSecretKeyRef: &mariadbv1alpha1.GeneratedSecretKeyRef{
							SecretKeySelector: mariadbv1alpha1.SecretKeySelector{
								LocalObjectReference: mariadbv1alpha1.LocalObjectReference{
									Name: testReplPasswordSecret,
								},
								Key: "password",
							},
						},
					},
				},
			},
			MultiCluster: &mariadbv1alpha1.MultiCluster{
				Enabled: true,
				MultiClusterSpec: mariadbv1alpha1.MultiClusterSpec{
					Primary: testPrimaryClusterName,
					Members: []mariadbv1alpha1.MultiClusterMember{
						{
							Name: testPrimaryClusterName,
							ExternalMariaDBRef: mariadbv1alpha1.ObjectReference{
								Name:      testExternalMariaDBName,
								Namespace: testNamespace,
							},
						},
					},
				},
			},
		},
	}
	if !mdb.IsMultiClusterReplica() {
		t.Fatalf("test setup error: MariaDB must be a multi-cluster replica")
	}

	externalMariaDB := &mariadbv1alpha1.ExternalMariaDB{
		ObjectMeta: metav1.ObjectMeta{
			Name:      testExternalMariaDBName,
			Namespace: testNamespace,
		},
		Spec: mariadbv1alpha1.ExternalMariaDBSpec{
			Host:     "primary.example.com",
			Port:     3306,
			Username: ptrTo("root"),
			PasswordSecretKeyRef: &mariadbv1alpha1.SecretKeySelector{
				LocalObjectReference: mariadbv1alpha1.LocalObjectReference{
					Name: testExternalPassSecret,
				},
				Key: "password",
			},
		},
	}

	replSecret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      testReplPasswordSecret,
			Namespace: testNamespace,
		},
		Data: map[string][]byte{"password": []byte("repl-secret-password")},
	}
	externalSecret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      testExternalPassSecret,
			Namespace: testNamespace,
		},
		Data: map[string][]byte{"password": []byte("external-secret-password")},
	}

	scheme := runtime.NewScheme()
	if err := clientgoscheme.AddToScheme(scheme); err != nil {
		t.Fatalf("error adding client-go scheme: %v", err)
	}
	if err := mariadbv1alpha1.AddToScheme(scheme); err != nil {
		t.Fatalf("error adding mariadbv1alpha1 scheme: %v", err)
	}

	fakeClient := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(externalMariaDB, replSecret, externalSecret).
		Build()

	refResolver := refresolver.New(fakeClient)
	logger := logr.Discard()
	userSqlReconciler := newUserSqlReconciler(mdb, refResolver, logger)

	return newMultiClusterTopology(mdb, nil, userSqlReconciler, fakeClient, refResolver, logger)
}

func ptrTo[T any](v T) *T { return &v }

// TestConfigurePrimaryReplicaResetsMultiClusterConnection is a regression test for
// https://github.com/arthurking87/mariadb-operator/pull/68 (issue #28): before the fix,
// configurePrimaryReplica only reset the local replica connection ("RESET SLAVE ALL"),
// leaving leftover master info/GTID position on the multi-cluster ("remote") replica
// connection, which could make the subsequent CHANGE MASTER/START SLAVE on that
// connection behave incorrectly. The fix resets the remote connection first, tolerating
// the case where it doesn't exist yet (SQL error 1617).
func TestConfigurePrimaryReplicaResetsMultiClusterConnection(t *testing.T) {
	remoteResetQuery := fmt.Sprintf("RESET SLAVE '%s' ALL;", MultiClusterReplicaConnectionName)
	localResetQuery := "RESET SLAVE  ALL;"

	tests := []struct {
		name    string
		execErr func(query string) error
	}{
		{
			name: "remote connection already exists",
			// All statements succeed, as if the multi-cluster replica connection
			// was already configured from a previous reconciliation.
			execErr: nil,
		},
		{
			name: "remote connection does not exist yet",
			// Simulates MariaDB error 1617 ("There is no master connection")
			// specifically for the remote RESET SLAVE, e.g. on first-time setup.
			// configurePrimaryReplica must swallow this specific error and continue.
			execErr: func(query string) error {
				if strings.HasPrefix(query, "RESET SLAVE") && strings.Contains(query, "'"+MultiClusterReplicaConnectionName+"'") {
					return errors.New("Error 1617 (HY000): There is no master connection 'multi-cluster'")
				}
				return nil
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			topology := newMultiClusterReplicaTestTopology(t)
			conn := &recordingConn{execErr: tt.execErr}
			client := newRecordingSQLClient(conn)
			defer client.Close()

			err := topology.configurePrimaryReplica(context.Background(), client)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			execs := conn.execsSnapshot()

			foundRemote := false
			foundLocal := false
			for _, exec := range execs {
				if exec == remoteResetQuery {
					foundRemote = true
				}
				if exec == localResetQuery {
					foundLocal = true
				}
			}

			if !foundRemote {
				t.Errorf("expected multi-cluster replica connection to be reset with %q, executed statements: %v",
					remoteResetQuery, execs)
			}
			if !foundLocal {
				t.Errorf("expected local replica connection to be reset with %q, executed statements: %v",
					localResetQuery, execs)
			}
		})
	}
}
