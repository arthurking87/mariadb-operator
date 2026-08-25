package controller

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/go-logr/logr"
	sqlClient "github.com/mariadb-operator/mariadb-operator/v26/pkg/sql"
)

// dirtyPagesConn is a minimal database/sql/driver.Conn that emulates MariaDB's
// innodb_max_dirty_pages_pct / innodb_max_dirty_pages_pct_lwm invariant (lwm <= pct must hold
// after every SET) and answers Innodb_buffer_pool_pages_dirty lookups from a caller-controlled
// sequence, so that flushInnodbBufferPool can be exercised end-to-end without a live MariaDB
// connection.
type dirtyPagesConn struct {
	mu  sync.Mutex
	pct int
	lwm int

	// dirtyPages is consumed one value per poll of Innodb_buffer_pool_pages_dirty; the last
	// value is reused once exhausted.
	dirtyPages []int
	dirtyIdx   int

	execs []string
}

var (
	setDirtyPagesVarRe    = regexp.MustCompile(`^SET @@global\.(innodb_max_dirty_pages_pct(?:_lwm)?)=(\d+);$`)
	selectDirtyPagesVarRe = regexp.MustCompile(`^SELECT @@global\.(innodb_max_dirty_pages_pct(?:_lwm)?);$`)
)

func (c *dirtyPagesConn) Prepare(query string) (driver.Stmt, error) {
	return nil, errors.New("dirtyPagesConn: Prepare not supported, use ExecContext/QueryContext")
}

func (c *dirtyPagesConn) Close() error { return nil }

func (c *dirtyPagesConn) Begin() (driver.Tx, error) {
	return nil, errors.New("dirtyPagesConn: Begin not supported")
}

func (c *dirtyPagesConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.execs = append(c.execs, query)

	m := setDirtyPagesVarRe.FindStringSubmatch(query)
	if m == nil {
		return driver.RowsAffected(0), nil
	}
	variable, rawValue := m[1], m[2]
	newVal, err := strconv.Atoi(rawValue)
	if err != nil {
		return nil, err
	}

	newPct, newLwm := c.pct, c.lwm
	if variable == "innodb_max_dirty_pages_pct" {
		newPct = newVal
	} else {
		newLwm = newVal
	}
	if newLwm > newPct {
		return nil, fmt.Errorf("Error 1231 (42000): variable '%s' can't be set to the value of '%d'", variable, newVal)
	}
	c.pct, c.lwm = newPct, newLwm
	return driver.RowsAffected(0), nil
}

func (c *dirtyPagesConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if m := selectDirtyPagesVarRe.FindStringSubmatch(query); m != nil {
		val := c.pct
		if m[1] == "innodb_max_dirty_pages_pct_lwm" {
			val = c.lwm
		}
		return &singleStringRow{value: strconv.Itoa(val)}, nil
	}

	// Innodb_buffer_pool_pages_dirty status lookup.
	dirty := 0
	switch {
	case c.dirtyIdx < len(c.dirtyPages):
		dirty = c.dirtyPages[c.dirtyIdx]
		c.dirtyIdx++
	case len(c.dirtyPages) > 0:
		dirty = c.dirtyPages[len(c.dirtyPages)-1]
	}
	return &singleStringRow{value: strconv.Itoa(dirty)}, nil
}

func (c *dirtyPagesConn) execsSnapshot() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.execs...)
}

func (c *dirtyPagesConn) settings() (pct, lwm int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.pct, c.lwm
}

// singleStringRow is a driver.Rows implementation yielding a single row with a single string
// column, mimicking the shape of the SELECT @@global.<var> and status-variable lookups issued by
// pkg/sql.Client.
type singleStringRow struct {
	value string
	done  bool
}

func (r *singleStringRow) Columns() []string { return []string{"value"} }
func (r *singleStringRow) Close() error      { return nil }
func (r *singleStringRow) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	dest[0] = r.value
	r.done = true
	return nil
}

type dirtyPagesDriver struct{}

func (dirtyPagesDriver) Open(name string) (driver.Conn, error) {
	return nil, errors.New("dirtyPagesDriver: Open not supported, use dirtyPagesConnector")
}

type dirtyPagesConnector struct {
	conn *dirtyPagesConn
}

func (c *dirtyPagesConnector) Connect(ctx context.Context) (driver.Conn, error) {
	return c.conn, nil
}

func (c *dirtyPagesConnector) Driver() driver.Driver {
	return dirtyPagesDriver{}
}

func newDirtyPagesSQLClient(conn *dirtyPagesConn) *sqlClient.Client {
	db := sql.OpenDB(&dirtyPagesConnector{conn: conn})
	return sqlClient.NewClientFromDB(db)
}

// TestFlushInnodbBufferPoolRestoresOriginalSettings is a regression test for a bug where
// flushInnodbBufferPool restored innodb_max_dirty_pages_pct_lwm before innodb_max_dirty_pages_pct.
// MariaDB requires innodb_max_dirty_pages_pct_lwm <= innodb_max_dirty_pages_pct at all times; since
// both are set to 0 while flushing, restoring lwm first would try to set it above the still-zero
// pct and fail, leaving lwm stuck at 0 instead of its original value. Restoring pct first avoids
// this, which dirtyPagesConn enforces the same way MariaDB itself does.
func TestFlushInnodbBufferPoolRestoresOriginalSettings(t *testing.T) {
	conn := &dirtyPagesConn{pct: 90, lwm: 10, dirtyPages: []int{0}}
	client := newDirtyPagesSQLClient(conn)
	defer client.Close()

	r := &PhysicalBackupReconciler{}
	if err := r.flushInnodbBufferPool(context.Background(), client, time.Second, logr.Discard()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	pct, lwm := conn.settings()
	if pct != 90 {
		t.Errorf("expected innodb_max_dirty_pages_pct to be restored to 90, got %d", pct)
	}
	if lwm != 10 {
		t.Errorf("expected innodb_max_dirty_pages_pct_lwm to be restored to 10, got %d", lwm)
	}

	execs := conn.execsSnapshot()
	pctRestoreIdx, lwmRestoreIdx := -1, -1
	for i, exec := range execs {
		switch exec {
		case "SET @@global.innodb_max_dirty_pages_pct=90;":
			pctRestoreIdx = i
		case "SET @@global.innodb_max_dirty_pages_pct_lwm=10;":
			lwmRestoreIdx = i
		}
	}
	if pctRestoreIdx == -1 || lwmRestoreIdx == -1 {
		t.Fatalf("expected both restore statements to be executed, got: %v", execs)
	}
	if pctRestoreIdx > lwmRestoreIdx {
		t.Errorf("expected innodb_max_dirty_pages_pct to be restored before innodb_max_dirty_pages_pct_lwm, executed statements: %v", execs)
	}
}

// TestFlushInnodbBufferPoolRestoresOnError verifies that the original settings are restored even
// when the poll for dirty pages to reach zero never succeeds (e.g. it times out), covering the
// restore-on-error path.
func TestFlushInnodbBufferPoolRestoresOnError(t *testing.T) {
	conn := &dirtyPagesConn{pct: 90, lwm: 10, dirtyPages: []int{99}} // never reaches zero
	client := newDirtyPagesSQLClient(conn)
	defer client.Close()

	r := &PhysicalBackupReconciler{}
	err := r.flushInnodbBufferPool(context.Background(), client, 1200*time.Millisecond, logr.Discard())
	if err == nil {
		t.Fatal("expected an error because dirty pages never reach zero")
	}

	pct, lwm := conn.settings()
	if pct != 90 || lwm != 10 {
		t.Errorf("expected settings to be restored after a failed flush, got pct=%d lwm=%d", pct, lwm)
	}
}

// TestFlushInnodbBufferPoolWaitsForDirtyPages verifies that flushInnodbBufferPool polls
// Innodb_buffer_pool_pages_dirty until it reaches zero before returning successfully.
func TestFlushInnodbBufferPoolWaitsForDirtyPages(t *testing.T) {
	conn := &dirtyPagesConn{pct: 50, lwm: 5, dirtyPages: []int{12, 6, 0}}
	client := newDirtyPagesSQLClient(conn)
	defer client.Close()

	r := &PhysicalBackupReconciler{}
	if err := r.flushInnodbBufferPool(context.Background(), client, 10*time.Second, logr.Discard()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	conn.mu.Lock()
	polled := conn.dirtyIdx
	conn.mu.Unlock()
	if polled < len(conn.dirtyPages) {
		t.Errorf("expected all %d dirty page readings to be polled, only polled %d", len(conn.dirtyPages), polled)
	}
}
