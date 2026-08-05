package sql

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"sync"
	"testing"

	"github.com/go-logr/logr"
)

// This file tests that the channel-aware replication operations (StartSlave, StopSlave,
// ResetSlave, IsReplicationReplica, ReplicaStatus, ChangeMaster) issue the exact SQL
// statement expected for a given replication connection name (channel). This is the
// mechanism that fix/issue-40-reset-replica-channel relies on to consistently target the
// named "mariadb-operator" / "multi-cluster" channels instead of MariaDB's default/legacy
// unnamed connection.
//
// A minimal database/sql/driver.Driver fake is used instead of a live MariaDB server so
// that the exact rendered SQL text can be captured and asserted on.

// recordingDriver is a fake database/sql/driver.Driver that records every SQL statement
// it is asked to execute or query, without needing a real database connection.
type recordingDriver struct {
	mu      sync.Mutex
	queries []string
}

func (d *recordingDriver) record(query string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.queries = append(d.queries, query)
}

func (d *recordingDriver) Queries() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]string, len(d.queries))
	copy(out, d.queries)
	return out
}

func (d *recordingDriver) LastQuery() string {
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(d.queries) == 0 {
		return ""
	}
	return d.queries[len(d.queries)-1]
}

func (d *recordingDriver) Open(name string) (driver.Conn, error) {
	return &recordingConn{driver: d}, nil
}

type recordingConn struct {
	driver *recordingDriver
}

func (c *recordingConn) Prepare(query string) (driver.Stmt, error) {
	return &recordingStmt{conn: c, query: query}, nil
}
func (c *recordingConn) Close() error { return nil }
func (c *recordingConn) Begin() (driver.Tx, error) {
	return nil, errors.New("transactions not supported by the recording fake driver")
}

type recordingStmt struct {
	conn  *recordingConn
	query string
}

func (s *recordingStmt) Close() error  { return nil }
func (s *recordingStmt) NumInput() int { return -1 }

func (s *recordingStmt) Exec(args []driver.Value) (driver.Result, error) {
	s.conn.driver.record(s.query)
	return driver.RowsAffected(0), nil
}

func (s *recordingStmt) Query(args []driver.Value) (driver.Rows, error) {
	s.conn.driver.record(s.query)
	return &singleValueRows{}, nil
}

// singleValueRows emulates a one-column, one-row result set. It is sufficient for every
// code path exercised below: QueryColumnMap (used by ReplicaStatus) only reads columns it
// recognizes by name and safely ignores the rest, and QueryRowContext/Scan (used by
// SystemVariable/GtidCurrentPos) just need exactly one row and one column to succeed.
type singleValueRows struct {
	served bool
}

func (r *singleValueRows) Columns() []string { return []string{"value"} }
func (r *singleValueRows) Close() error      { return nil }

func (r *singleValueRows) Next(dest []driver.Value) error {
	if r.served {
		return io.EOF
	}
	r.served = true
	dest[0] = "1"
	return nil
}

// newRecordingClient builds a *Client backed by the recording fake driver instead of a
// real network connection to MariaDB.
func newRecordingClient(t *testing.T) (*Client, *recordingDriver) {
	t.Helper()
	drv := &recordingDriver{}
	driverName := fmt.Sprintf("recording-%s", t.Name())
	sql.Register(driverName, drv)

	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatalf("error opening fake db: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	return &Client{db: db}, drv
}

func TestStartSlaveChannel(t *testing.T) {
	tests := []struct {
		name          string
		connectionOpt []ReplicationOpt
		wantQuery     string
	}{
		{
			name:          "default/unnamed channel",
			connectionOpt: nil,
			wantQuery:     "START SLAVE ;",
		},
		{
			name:          "named intra-cluster channel",
			connectionOpt: []ReplicationOpt{WithConnectionName("mariadb-operator")},
			wantQuery:     "START SLAVE 'mariadb-operator';",
		},
		{
			name:          "named multi-cluster channel",
			connectionOpt: []ReplicationOpt{WithConnectionName("multi-cluster")},
			wantQuery:     "START SLAVE 'multi-cluster';",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, drv := newRecordingClient(t)
			if err := client.StartSlave(context.Background(), tt.connectionOpt...); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got := drv.LastQuery(); got != tt.wantQuery {
				t.Errorf("got query %q, want %q", got, tt.wantQuery)
			}
		})
	}
}

func TestStopSlaveChannel(t *testing.T) {
	tests := []struct {
		name          string
		connectionOpt []ReplicationOpt
		wantQuery     string
	}{
		{
			name:          "default/unnamed channel",
			connectionOpt: nil,
			wantQuery:     "STOP SLAVE ;",
		},
		{
			name:          "named intra-cluster channel",
			connectionOpt: []ReplicationOpt{WithConnectionName("mariadb-operator")},
			wantQuery:     "STOP SLAVE 'mariadb-operator';",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, drv := newRecordingClient(t)
			if err := client.StopSlave(context.Background(), tt.connectionOpt...); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got := drv.LastQuery(); got != tt.wantQuery {
				t.Errorf("got query %q, want %q", got, tt.wantQuery)
			}
		})
	}
}

func TestResetSlaveChannel(t *testing.T) {
	tests := []struct {
		name          string
		connectionOpt []ReplicationOpt
		wantQuery     string
	}{
		{
			name:          "default/unnamed channel",
			connectionOpt: nil,
			wantQuery:     "RESET SLAVE  ALL;",
		},
		{
			name:          "named intra-cluster channel",
			connectionOpt: []ReplicationOpt{WithConnectionName("mariadb-operator")},
			wantQuery:     "RESET SLAVE 'mariadb-operator' ALL;",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, drv := newRecordingClient(t)
			if err := client.ResetSlave(context.Background(), tt.connectionOpt...); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got := drv.LastQuery(); got != tt.wantQuery {
				t.Errorf("got query %q, want %q", got, tt.wantQuery)
			}
		})
	}
}

func TestIsReplicationReplicaChannel(t *testing.T) {
	tests := []struct {
		name          string
		connectionOpt []ReplicationOpt
		wantQuery     string
	}{
		{
			name:          "default/unnamed channel",
			connectionOpt: nil,
			wantQuery:     "SHOW REPLICA  STATUS",
		},
		{
			name:          "named intra-cluster channel",
			connectionOpt: []ReplicationOpt{WithConnectionName("mariadb-operator")},
			wantQuery:     "SHOW REPLICA 'mariadb-operator' STATUS",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, drv := newRecordingClient(t)
			isReplica, err := client.IsReplicationReplica(context.Background(), tt.connectionOpt...)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !isReplica {
				t.Errorf("expected IsReplicationReplica to report true for the fake single-row result set")
			}
			if got := drv.LastQuery(); got != tt.wantQuery {
				t.Errorf("got query %q, want %q", got, tt.wantQuery)
			}
		})
	}
}

func TestReplicaStatusChannel(t *testing.T) {
	tests := []struct {
		name          string
		connectionOpt []ReplicationOpt
		wantQuery     string
	}{
		{
			name:          "default/unnamed channel",
			connectionOpt: nil,
			wantQuery:     "SHOW REPLICA  STATUS",
		},
		{
			name:          "named intra-cluster channel",
			connectionOpt: []ReplicationOpt{WithConnectionName("mariadb-operator")},
			wantQuery:     "SHOW REPLICA 'mariadb-operator' STATUS",
		},
		{
			name:          "named multi-cluster channel",
			connectionOpt: []ReplicationOpt{WithConnectionName("multi-cluster")},
			wantQuery:     "SHOW REPLICA 'multi-cluster' STATUS",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, drv := newRecordingClient(t)
			if _, err := client.ReplicaStatus(context.Background(), logr.Discard(), tt.connectionOpt...); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			// ReplicaStatus issues "SHOW REPLICA ... STATUS" first, followed by a
			// gtid_current_pos lookup, so check the queries as a whole rather than
			// only the last one.
			found := false
			for _, q := range drv.Queries() {
				if q == tt.wantQuery {
					found = true
					break
				}
			}
			if !found {
				t.Errorf("expected query %q among issued queries %v", tt.wantQuery, drv.Queries())
			}
		})
	}
}

// TestChangeMasterChannel verifies that Client.ChangeMaster (not just the pure
// buildChangeMasterQuery helper already covered in sql_test.go) actually executes the
// rendered CHANGE MASTER statement including the named connection, closing the loop
// between "the query is built correctly" and "the query is the one sent to the server".
func TestChangeMasterChannel(t *testing.T) {
	client, drv := newRecordingClient(t)

	err := client.ChangeMaster(context.Background(),
		WithChangeMasterConnectionName("mariadb-operator"),
		WithChangeMasterHost("127.0.0.1"),
		WithChangeMasterPort(3306),
		WithChangeMasterCredentials("repl", "password"),
		WithChangeMasterGtid("CurrentPos"),
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := `CHANGE MASTER 'mariadb-operator' TO
MASTER_HOST='127.0.0.1',
MASTER_PORT=3306,
MASTER_USER='repl',
MASTER_PASSWORD='password',
MASTER_USE_GTID=CurrentPos;
`
	if got := drv.LastQuery(); got != want {
		t.Errorf("got query %q, want %q", got, want)
	}
}
