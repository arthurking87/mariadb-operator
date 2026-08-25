package controller

import (
	"context"
	stddb "database/sql"
	"database/sql/driver"
	"errors"
	"strings"
	"sync"
	"testing"

	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	"github.com/mariadb-operator/mariadb-operator/v26/pkg/refresolver"
	sqlClient "github.com/mariadb-operator/mariadb-operator/v26/pkg/sql"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

// recordingConn is a fake driver.Conn that records every executed statement's text.
type recordingConn struct {
	mu    sync.Mutex
	execs []string
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
	return driver.RowsAffected(0), nil
}

func (c *recordingConn) snapshot() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]string, len(c.execs))
	copy(out, c.execs)
	return out
}

type recordingDriver struct{}

func (recordingDriver) Open(name string) (driver.Conn, error) {
	return nil, errors.New("use connector")
}

type recordingConnector struct{ conn *recordingConn }

func (c *recordingConnector) Connect(ctx context.Context) (driver.Conn, error) { return c.conn, nil }
func (c *recordingConnector) Driver() driver.Driver                            { return recordingDriver{} }

// TestGrantOptionRevokeOrdering is a regression test for #31: the opts (containing
// sqlClient.WithGrantOption()) used to be built AFTER the Revoke call, so a Revoke
// for a Grant with GrantOption=true would not include "GRANT OPTION" in the REVOKE
// statement. The fix builds opts before Revoke, so both Revoke and Grant receive it.
func TestGrantOptionRevokeOrdering(t *testing.T) {
	conn := &recordingConn{}
	db := stddb.OpenDB(&recordingConnector{conn: conn})
	mdbClient := sqlClient.NewClientFromDB(db)

	scheme := runtime.NewScheme()
	if err := clientgoscheme.AddToScheme(scheme); err != nil {
		t.Fatalf("error adding client-go scheme: %v", err)
	}
	if err := mariadbv1alpha1.AddToScheme(scheme); err != nil {
		t.Fatalf("error adding mariadbv1alpha1 scheme: %v", err)
	}

	grant := &mariadbv1alpha1.Grant{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "grant-option-revoke-test",
			Namespace: "default",
		},
		Spec: mariadbv1alpha1.GrantSpec{
			MariaDBRef: mariadbv1alpha1.MariaDBRef{
				ObjectReference: mariadbv1alpha1.ObjectReference{
					Name: "mariadb-test",
				},
			},
			Privileges:  []string{"SELECT"},
			Database:    "test_db",
			Table:       "*",
			Username:    "test-user",
			GrantOption: true,
		},
		Status: mariadbv1alpha1.GrantStatus{
			// Existing privileges differ from Spec.Privileges so that
			// privilegesToRevoke() returns a non-empty slice and Revoke actually runs.
			CurrentPrivileges: []string{"SELECT", "INSERT"},
		},
	}

	fakeK8sClient := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(grant).
		WithStatusSubresource(grant).
		Build()

	refResolver := refresolver.New(fakeK8sClient)

	wr := newWrappedGrantReconciler(fakeK8sClient, *refResolver, grant)

	if err := wr.Reconcile(context.Background(), mdbClient); err != nil {
		t.Fatalf("Reconcile returned an unexpected error: %v", err)
	}

	execs := conn.snapshot()

	var revokeStmt, grantStmt string
	for _, stmt := range execs {
		switch {
		case strings.HasPrefix(stmt, "REVOKE"):
			revokeStmt = stmt
		case strings.HasPrefix(stmt, "GRANT"):
			grantStmt = stmt
		}
	}

	if revokeStmt == "" {
		t.Fatalf("expected a REVOKE statement to be executed, got exec log: %v", execs)
	}
	if !strings.Contains(revokeStmt, "GRANT OPTION") {
		t.Errorf("expected REVOKE statement to contain %q, got: %q", "GRANT OPTION", revokeStmt)
	}

	if grantStmt == "" {
		t.Fatalf("expected a GRANT statement to be executed, got exec log: %v", execs)
	}
	if !strings.Contains(grantStmt, "WITH GRANT OPTION") {
		t.Errorf("expected GRANT statement to contain %q, got: %q", "WITH GRANT OPTION", grantStmt)
	}
}
