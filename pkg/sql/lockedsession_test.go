package sql

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"sync/atomic"
	"testing"
)

// fakeConn is a minimal database/sql/driver.Conn standing in for a dedicated MariaDB session,
// so LockTablesWithReadLock/LockedSession.Unlock can be exercised for real without a live
// server. It only implements what database/sql actually calls for a plain ExecContext-based
// query: Prepare/Begin are never expected to be hit.
type fakeConn struct {
	closed    atomic.Bool
	execCount atomic.Int32
}

func (c *fakeConn) Prepare(query string) (driver.Stmt, error) {
	return nil, errors.New("fakeConn: Prepare not supported")
}

func (c *fakeConn) Close() error {
	c.closed.Store(true)
	return nil
}

func (c *fakeConn) Begin() (driver.Tx, error) {
	return nil, errors.New("fakeConn: Begin not supported")
}

// ExecContext implements driver.ExecerContext, so database/sql routes ExecContext straight
// here instead of falling back to a Prepare/Exec round trip.
func (c *fakeConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if c.closed.Load() {
		// Mirrors what a real driver reports once the underlying TCP connection has died,
		// e.g. because the primary Pod was replaced mid-switchover.
		return nil, errors.New("fakeConn: exec on closed connection")
	}
	c.execCount.Add(1)
	return driver.RowsAffected(0), nil
}

type fakeDriver struct{}

func (fakeDriver) Open(name string) (driver.Conn, error) {
	return nil, errors.New("fakeDriver: Open not supported, use fakeConnector")
}

// fakeConnector always hands back the same *fakeConn, modeling the single dedicated
// connection that Client.LockTablesWithReadLock checks out of the pool for the lifetime of
// the lock.
type fakeConnector struct {
	conn *fakeConn
}

func (c *fakeConnector) Connect(ctx context.Context) (driver.Conn, error) {
	return c.conn, nil
}

func (c *fakeConnector) Driver() driver.Driver {
	return fakeDriver{}
}

// newFakeClient builds a Client backed by a fake driver connection. It's only possible from
// within this package (Client.db is unexported), which is exactly why this test lives here
// rather than alongside pkg/controller/replication's tests.
func newFakeClient(t *testing.T, conn *fakeConn) *Client {
	t.Helper()
	db := sql.OpenDB(&fakeConnector{conn: conn})
	t.Cleanup(func() { _ = db.Close() })
	return &Client{db: db}
}

// TestLockTablesWithReadLock_Unlock covers the LockedSession machinery introduced by PR #87:
// FLUSH TABLES WITH READ LOCK is acquired on a dedicated connection, and Unlock releases it on
// that same connection and returns it to the pool.
func TestLockTablesWithReadLock_Unlock(t *testing.T) {
	conn := &fakeConn{}
	client := newFakeClient(t, conn)

	session, err := client.LockTablesWithReadLock(context.Background())
	if err != nil {
		t.Fatalf("unexpected error acquiring lock: %v", err)
	}
	if got := conn.execCount.Load(); got != 1 {
		t.Fatalf("expected FLUSH TABLES WITH READ LOCK to run exactly once, got execCount=%d", got)
	}
	if conn.closed.Load() {
		t.Fatal("expected the dedicated connection to stay open while the lock is held")
	}

	if err := session.Unlock(context.Background()); err != nil {
		t.Fatalf("unexpected error unlocking: %v", err)
	}
	if got := conn.execCount.Load(); got != 2 {
		t.Fatalf("expected UNLOCK TABLES to run as the second statement, got execCount=%d", got)
	}
	// Note: we don't assert conn.closed here. database/sql's *sql.Conn.Close() returns the
	// connection to the pool for reuse rather than necessarily closing the underlying
	// driver.Conn immediately (idle connections are kept around per MaxIdleConns) -- that pool
	// bookkeeping isn't what this test is about.
}

// TestLockedSession_UnlockOnDeadConnection covers the scenario behind the "double-unlock on
// dead session" bug fixed in PR #87: if the connection backing the lock has already died (e.g.
// the primary Pod was replaced mid-switchover), Unlock must return a clean error rather than
// panicking or hanging, so callers (pkg/controller/replication's rollbackSwitchover) can log it
// and move on without retrying against the same broken connection.
func TestLockedSession_UnlockOnDeadConnection(t *testing.T) {
	conn := &fakeConn{}
	client := newFakeClient(t, conn)

	session, err := client.LockTablesWithReadLock(context.Background())
	if err != nil {
		t.Fatalf("unexpected error acquiring lock: %v", err)
	}

	// Simulate the underlying connection dying after the lock was acquired but before it
	// could be released.
	conn.closed.Store(true)

	if err := session.Unlock(context.Background()); err == nil {
		t.Fatal("expected an error unlocking a dead connection, got nil")
	}
	if got := conn.execCount.Load(); got != 1 {
		t.Fatalf("expected only the original FLUSH TABLES exec to have succeeded, got execCount=%d", got)
	}
}
