package sql

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"testing"
)

// scanErrConn is a fake driver.Conn whose QueryContext returns a driver.Rows
// with zero columns. Scanning such a row into a single destination (as
// SystemVariable does with `row.Scan(&val)`) makes database/sql return a
// non-nil error from Scan, without the underlying Query call itself failing.
// This lets the test exercise the `row.Scan(&val)` error path specifically,
// rather than a query-level error.
type scanErrConn struct{}

func (c *scanErrConn) Prepare(query string) (driver.Stmt, error) {
	return nil, errors.New("not supported")
}

func (c *scanErrConn) Close() error { return nil }

func (c *scanErrConn) Begin() (driver.Tx, error) {
	return nil, errors.New("not supported")
}

func (c *scanErrConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	return &noColsRows{}, nil
}

// noColsRows is a driver.Rows implementation reporting zero columns but still
// yielding one row, so Scan(&val) fails with a destination count mismatch.
type noColsRows struct {
	done bool
}

func (r *noColsRows) Columns() []string { return []string{} }

func (r *noColsRows) Close() error { return nil }

func (r *noColsRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	return nil
}

type scanErrDriver struct{}

func (scanErrDriver) Open(name string) (driver.Conn, error) {
	return nil, errors.New("use connector")
}

type scanErrConnector struct{}

func (c *scanErrConnector) Connect(ctx context.Context) (driver.Conn, error) {
	return &scanErrConn{}, nil
}

func (c *scanErrConnector) Driver() driver.Driver { return scanErrDriver{} }

// TestSystemVariable_ScanErrorIsPropagated is a regression test for the bug
// where Client.SystemVariable swallowed the error returned by row.Scan and
// always returned (\"\", nil) on a scan failure. It now must propagate the
// scan error to the caller.
func TestSystemVariable_ScanErrorIsPropagated(t *testing.T) {
	db := sql.OpenDB(&scanErrConnector{})
	defer db.Close()

	client := &Client{db: db}

	val, err := client.SystemVariable(context.Background(), "read_only")

	if err == nil {
		t.Fatalf("expected a non-nil error from SystemVariable when Scan fails, got nil (val=%q)", val)
	}
	if val != "" {
		t.Fatalf("expected empty string value on scan error, got %q", val)
	}
}
