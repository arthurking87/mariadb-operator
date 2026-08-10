package controller

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"unsafe"

	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	sqlClient "github.com/mariadb-operator/mariadb-operator/v26/pkg/sql"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// This test file exercises the fix for issue #48 in wrappedUserReconciler.Reconcile
// (internal/controller/user_controller.go): previously, an error returned by
// mdbClient.UserExists() was only logged via log.FromContext(ctx).Error(...) and
// swallowed. Execution continued with `exists` left at its zero value (false),
// so a transient SQL error was silently misinterpreted as "the user does not
// exist" and reconciliation proceeded to DROP and (re)CREATE the user instead
// of failing and requeuing. The fix returns the error immediately:
//
//	exists, err := mdbClient.UserExists(ctx, username, hostname)
//	if err != nil {
//	    return fmt.Errorf("error checking if User exists: %v", err)
//	}
//
// Returning the error causes it to propagate up through sql.SqlReconciler,
// which patches the User's Ready status condition with the failure and
// requeues, instead of silently corrupting reconciliation state.
//
// Since sqlClient.Client wraps an unexported *sql.DB and only exposes methods
// that issue real SQL, we drive this behavior with a minimal in-process
// database/sql/driver that fails every Prepare() call -- simulating a broken
// DB connection without requiring a real MariaDB instance or touching any
// production code.

// failingDriver is a database/sql/driver.Driver whose connections fail to
// prepare any statement and record every query they were asked to prepare,
// so tests can assert exactly how many SQL statements were attempted.
type failingDriver struct {
	mu      sync.Mutex
	queries []string
}

var errSimulatedConnFailure = errors.New("simulated connection failure")

func (d *failingDriver) Open(string) (driver.Conn, error) {
	return &failingConn{driver: d}, nil
}

func (d *failingDriver) recordQuery(query string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.queries = append(d.queries, query)
}

func (d *failingDriver) queryCount() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.queries)
}

type failingConn struct {
	driver *failingDriver
}

func (c *failingConn) Prepare(query string) (driver.Stmt, error) {
	c.driver.recordQuery(query)
	return nil, errSimulatedConnFailure
}

func (c *failingConn) Close() error { return nil }

func (c *failingConn) Begin() (driver.Tx, error) {
	return nil, errSimulatedConnFailure
}

var failingDriverSeq int64

// newFailingSQLClient registers a fresh failingDriver under a unique name
// (drivers cannot be re-registered under the same name) and wires it into a
// *sqlClient.Client via its unexported `db` field, since the field has no
// exported setter and NewClient() always dials a real MariaDB connection.
func newFailingSQLClient(t *testing.T) (*sqlClient.Client, *failingDriver) {
	t.Helper()

	fd := &failingDriver{}
	driverName := fmt.Sprintf("failing-mysql-%d", atomic.AddInt64(&failingDriverSeq, 1))
	sql.Register(driverName, fd)

	db, err := sql.Open(driverName, "test")
	if err != nil {
		t.Fatalf("unexpected error opening fake sql.DB: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	c := &sqlClient.Client{}
	dbField := reflect.ValueOf(c).Elem().FieldByName("db")
	if !dbField.IsValid() {
		t.Fatalf("sqlClient.Client no longer has an unexported 'db' field; update this test helper")
	}
	settable := reflect.NewAt(dbField.Type(), unsafe.Pointer(dbField.UnsafeAddr())).Elem()
	settable.Set(reflect.ValueOf(db))

	return c, fd
}

// TestWrappedUserReconciler_PropagatesUserExistsError proves that a failure
// from mdbClient.UserExists() is propagated as a reconcile error instead of
// being swallowed. Regression signature: before the fix, this test fails on
// both assertions -- the returned error would report "error dropping User"
// (not "error checking if User exists"), and two queries would have been
// attempted (the failed existence check followed by a DROP USER) instead of
// just one, because reconciliation incorrectly continued past the failed
// check.
func TestWrappedUserReconciler_PropagatesUserExistsError(t *testing.T) {
	mdbClient, fd := newFailingSQLClient(t)

	user := &mariadbv1alpha1.User{
		ObjectMeta: metav1.ObjectMeta{
			Name: "test-user",
		},
	}

	wr := newWrapperUserReconciler(nil, nil, user)

	err := wr.Reconcile(context.Background(), mdbClient)

	if err == nil {
		t.Fatal("expected Reconcile to return an error when UserExists fails, got nil")
	}
	if !strings.Contains(err.Error(), "error checking if User exists") {
		t.Errorf("expected the UserExists error to propagate out of Reconcile, got: %v", err)
	}
	if got := fd.queryCount(); got != 1 {
		t.Errorf("expected Reconcile to stop after the single failed UserExists check, but %d SQL statements were attempted (%v); "+
			"this means the UserExists error was swallowed and reconciliation incorrectly proceeded to drop/create the user",
			got, fd.queries)
	}
}
