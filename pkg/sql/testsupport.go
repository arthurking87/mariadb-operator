package sql

import "database/sql"

// NewClientFromDB wraps an existing *sql.DB into a Client. Exported so that higher-level
// reconcilers accepting a *Client (e.g. internal/controller, pkg/controller/replication) can
// be exercised in tests against a fake/mock driver, without needing a live MariaDB connection.
// Client.db itself stays unexported; this is the only supported way to inject a test double
// from outside this package.
func NewClientFromDB(db *sql.DB) *Client {
	return &Client{db: db}
}
