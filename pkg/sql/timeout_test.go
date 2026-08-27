package sql

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"sync"
	"testing"
	"time"
)

// timeoutRecordingConn is a minimal database/sql/driver.Conn that records the deadline (if any)
// on the context passed to ExecContext, and counts how many times Ping is called, so tests can
// assert on both without a live MariaDB connection.
type timeoutRecordingConn struct {
	mu         sync.Mutex
	pingCalls  int
	execDDL    []time.Time // deadline of the ctx passed to each ExecContext call, zero value if none
	execHasDDL []bool
}

func (c *timeoutRecordingConn) Prepare(query string) (driver.Stmt, error) {
	return nil, errors.New("timeoutRecordingConn: Prepare not supported, use ExecContext")
}

func (c *timeoutRecordingConn) Close() error { return nil }

func (c *timeoutRecordingConn) Begin() (driver.Tx, error) {
	return nil, errors.New("timeoutRecordingConn: Begin not supported")
}

func (c *timeoutRecordingConn) Ping(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.pingCalls++
	return nil
}

func (c *timeoutRecordingConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	deadline, ok := ctx.Deadline()
	c.execDDL = append(c.execDDL, deadline)
	c.execHasDDL = append(c.execHasDDL, ok)
	return driver.RowsAffected(0), nil
}

func (c *timeoutRecordingConn) snapshot() (pingCalls int, execDDL []time.Time, execHasDDL []bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.pingCalls, append([]time.Time(nil), c.execDDL...), append([]bool(nil), c.execHasDDL...)
}

type timeoutRecordingDriver struct{}

func (timeoutRecordingDriver) Open(name string) (driver.Conn, error) {
	return nil, errors.New("timeoutRecordingDriver: Open not supported, use timeoutRecordingConnector")
}

type timeoutRecordingConnector struct {
	conn *timeoutRecordingConn
}

func (c *timeoutRecordingConnector) Connect(ctx context.Context) (driver.Conn, error) {
	return c.conn, nil
}

func (c *timeoutRecordingConnector) Driver() driver.Driver {
	return timeoutRecordingDriver{}
}

func newTimeoutRecordingClient(conn *timeoutRecordingConn) *Client {
	db := sql.OpenDB(&timeoutRecordingConnector{conn: conn})
	return NewClientFromDB(db)
}

// TestExecDoesNotPing is a regression test for the TOCTOU concern raised on the ping-before-exec
// design: c.db is a connection pool, so the connection Ping would check out isn't guaranteed to be
// the one a subsequent Exec gets, meaning the ping doesn't actually protect Exec against a dead
// connection — it only adds an extra round trip to every call. Exec must rely solely on its context
// deadline instead.
func TestExecDoesNotPing(t *testing.T) {
	conn := &timeoutRecordingConn{}
	client := newTimeoutRecordingClient(conn)
	defer client.Close()

	if err := client.Exec(context.Background(), "SELECT 1;"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	pingCalls, _, _ := conn.snapshot()
	if pingCalls != 0 {
		t.Errorf("expected Exec not to call Ping, but it was called %d time(s)", pingCalls)
	}
}

// TestPingIsStandaloneAndStillWorks ensures Ping itself still works as an explicit, standalone
// liveness check, even though Exec/Query/QueryRow no longer call it internally.
func TestPingIsStandaloneAndStillWorks(t *testing.T) {
	conn := &timeoutRecordingConn{}
	client := newTimeoutRecordingClient(conn)
	defer client.Close()

	if err := client.Ping(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	pingCalls, _, _ := conn.snapshot()
	if pingCalls != 1 {
		t.Errorf("expected Ping to be called exactly once, got %d", pingCalls)
	}
}

// TestExecAppliesDefaultQueryTimeout verifies a plain Exec call, given a context with no deadline
// of its own, gets one bounded by defaultQueryTimeout (~10s), not lockDefaultTimeout.
func TestExecAppliesDefaultQueryTimeout(t *testing.T) {
	conn := &timeoutRecordingConn{}
	client := newTimeoutRecordingClient(conn)
	defer client.Close()

	before := time.Now()
	if err := client.Exec(context.Background(), "SELECT 1;"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	after := time.Now()

	_, execDDL, execHasDDL := conn.snapshot()
	if len(execDDL) != 1 || !execHasDDL[0] {
		t.Fatalf("expected ExecContext to receive a context with a deadline, got hasDeadline=%v", execHasDDL)
	}
	assertDeadlineWithin(t, execDDL[0], before, after, defaultQueryTimeout)
}

// TestLockTablesWithReadLockAppliesLongerTimeout is a regression test for the finding that a
// blanket defaultQueryTimeout (10s) on FLUSH TABLES WITH READ LOCK could turn an ordinary "busy
// primary, lock takes a while to acquire" wait into a hard failure. LockTablesWithReadLock must get
// lockDefaultTimeout (60s) instead when the caller's context has no deadline of its own.
func TestLockTablesWithReadLockAppliesLongerTimeout(t *testing.T) {
	conn := &timeoutRecordingConn{}
	client := newTimeoutRecordingClient(conn)
	defer client.Close()

	before := time.Now()
	if err := client.LockTablesWithReadLock(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	after := time.Now()

	_, execDDL, execHasDDL := conn.snapshot()
	if len(execDDL) != 1 || !execHasDDL[0] {
		t.Fatalf("expected ExecContext to receive a context with a deadline, got hasDeadline=%v", execHasDDL)
	}
	assertDeadlineWithin(t, execDDL[0], before, after, lockDefaultTimeout)
}

// TestLockTablesWithReadLockRespectsCallerDeadline ensures a caller-supplied deadline is left
// untouched rather than being widened to lockDefaultTimeout.
func TestLockTablesWithReadLockRespectsCallerDeadline(t *testing.T) {
	conn := &timeoutRecordingConn{}
	client := newTimeoutRecordingClient(conn)
	defer client.Close()

	callerTimeout := 2 * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), callerTimeout)
	defer cancel()

	before := time.Now()
	if err := client.LockTablesWithReadLock(ctx); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	after := time.Now()

	_, execDDL, execHasDDL := conn.snapshot()
	if len(execDDL) != 1 || !execHasDDL[0] {
		t.Fatalf("expected ExecContext to receive a context with a deadline, got hasDeadline=%v", execHasDDL)
	}
	assertDeadlineWithin(t, execDDL[0], before, after, callerTimeout)
}

// assertDeadlineWithin checks that deadline falls within [callStart+want, callEnd+want], with a
// small tolerance for scheduling jitter, proving withTimeoutDefault attached `want` rather than
// some other duration.
func assertDeadlineWithin(t *testing.T, deadline, callStart, callEnd time.Time, want time.Duration) {
	t.Helper()
	const tolerance = 2 * time.Second
	minExpected := callStart.Add(want - tolerance)
	maxExpected := callEnd.Add(want + tolerance)
	if deadline.Before(minExpected) || deadline.After(maxExpected) {
		t.Errorf("deadline %v not within expected range [%v, %v] for a %v timeout",
			deadline, minExpected, maxExpected, want)
	}
}
