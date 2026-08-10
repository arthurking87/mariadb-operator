package controller

import (
	"context"
	stddb "database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"

	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/refresolver"
	sqlClient "github.com/mariadb-operator/mariadb-operator/v26/pkg/sql"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

// maxConnsRecordingConn is a minimal driver.Conn that records every statement it is asked to
// execute or query, so tests can assert on the exact SQL that the reconciler issued
// without needing a live MariaDB connection.
type maxConnsRecordingConn struct {
	mu      sync.Mutex
	execs   []string
	queries []string
}

func (c *maxConnsRecordingConn) Prepare(query string) (driver.Stmt, error) {
	return nil, errors.New("not supported")
}
func (c *maxConnsRecordingConn) Close() error              { return nil }
func (c *maxConnsRecordingConn) Begin() (driver.Tx, error) { return nil, errors.New("not supported") }

func (c *maxConnsRecordingConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.mu.Lock()
	c.execs = append(c.execs, query)
	c.mu.Unlock()
	return driver.RowsAffected(0), nil
}

// QueryContext makes every query return exactly one row, so that UserExists (which relies on
// Client.Exists / rows.Next()) sees the account as already existing. This drives Reconcile into
// the AlterUser branch under test.
func (c *maxConnsRecordingConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.mu.Lock()
	c.queries = append(c.queries, query)
	c.mu.Unlock()
	return &oneRowRows{}, nil
}

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

type maxConnsRecordingDriver struct{}

func (maxConnsRecordingDriver) Open(name string) (driver.Conn, error) {
	return nil, errors.New("use connector")
}

type maxConnsRecordingConnector struct{ conn *maxConnsRecordingConn }

func (c *maxConnsRecordingConnector) Connect(ctx context.Context) (driver.Conn, error) {
	return c.conn, nil
}

func (c *maxConnsRecordingConnector) Driver() driver.Driver {
	return maxConnsRecordingDriver{}
}

// TestReconcileAppliesMaxUserConnectionsWithoutPassword is a regression test for
// https://github.com/mariadb-operator/mariadb-operator/issues/34: wrappedUserReconciler.Reconcile
// must call AlterUser for an existing account even when no password-related field is set on the
// User spec, so that spec-only changes such as MaxUserConnections are actually applied.
func TestReconcileAppliesMaxUserConnectionsWithoutPassword(t *testing.T) {
	conn := &maxConnsRecordingConn{}
	db := stddb.OpenDB(&maxConnsRecordingConnector{conn: conn})
	defer db.Close()
	mdbClient := sqlClient.NewClientFromDB(db)

	user := &mariadbv1alpha1.User{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "user-no-password",
			Namespace: "default",
		},
		Spec: mariadbv1alpha1.UserSpec{
			MariaDBRef: mariadbv1alpha1.MariaDBRef{
				ObjectReference: mariadbv1alpha1.ObjectReference{
					Name: "mariadb-test",
				},
			},
			// Deliberately no PasswordSecretKeyRef, PasswordHashSecretKeyRef or PasswordPlugin:
			// this is the exact scenario that used to be silently skipped by AlterUser.
			MaxUserConnections: 42,
		},
	}

	scheme := newTestScheme(t)
	fakeK8sClient := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(user).
		WithStatusSubresource(user).
		Build()
	refResolver := refresolver.New(fakeK8sClient)

	wr := newWrapperUserReconciler(fakeK8sClient, refResolver, user)

	err := wr.Reconcile(context.Background(), mdbClient)
	require.NoError(t, err)

	conn.mu.Lock()
	defer conn.mu.Unlock()

	var alterStmt string
	for _, exec := range conn.execs {
		if strings.HasPrefix(exec, "ALTER USER") {
			alterStmt = exec
		}
		require.False(t, strings.HasPrefix(exec, "CREATE USER"),
			"expected no CREATE USER statement since UserExists reports the account as existing, got: %s", exec)
	}
	require.NotEmpty(t, alterStmt, "expected an ALTER USER statement to have been executed, execs: %v", conn.execs)
	require.Contains(t, alterStmt, "MAX_USER_CONNECTIONS 42")
}

func newTestScheme(t *testing.T) *runtime.Scheme {
	t.Helper()
	s := runtime.NewScheme()
	require.NoError(t, mariadbv1alpha1.AddToScheme(s))
	return s
}
