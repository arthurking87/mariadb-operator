package sql

import (
	"errors"
	"fmt"
	"testing"
)

// TestIsConnectionNotExists exercises the decision logic used throughout
// pkg/controller/replication to distinguish "the named replication channel
// has not been created yet" (safe to ignore) from a genuine SQL error (must
// be propagated). This guard is what allows ConfigurePrimary/ConfigureReplica
// to run against a MariaDB server that has never had the named
// "mariadb-operator" connection configured, e.g. the very first reconcile
// after upgrading to a version that introduces the named channel.
func TestIsConnectionNotExists(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{
			name: "nil error",
			err:  nil,
			want: false,
		},
		{
			name: "error 1617 for the named channel",
			err:  errors.New("Error 1617 (HY000): There is no master connection 'mariadb-operator'"),
			want: true,
		},
		{
			name: "error 1617 for the default/unnamed channel",
			err:  errors.New("Error 1617 (HY000): There is no master connection ''"),
			want: true,
		},
		{
			name: "error 1617 for the multi-cluster channel",
			err:  errors.New("Error 1617 (HY000): There is no master connection 'multi-cluster'"),
			want: true,
		},
		{
			name: "wrapped error 1617 still matches",
			err:  fmt.Errorf("error stopping slaves: %w", errors.New("Error 1617 (HY000): There is no master connection 'mariadb-operator'")),
			want: true,
		},
		{
			name: "unrelated SQL error code must not be swallowed",
			err:  errors.New("Error 1045 (28000): Access denied for user 'root'@'%'"),
			want: false,
		},
		{
			name: "the connection-conflict error must not be treated as not-exists",
			// Error 1934 is raised when a named channel is added alongside an existing
			// (e.g. legacy unnamed) connection with a conflicting name - it is a distinct
			// failure mode from "connection not exists" and must be surfaced, not ignored.
			err:  errors.New("Error 1934 (HY000): Connection 'mariadb-operator' conflicts with existing connection ''"),
			want: false,
		},
		{
			name: "generic error without a numeric SQL code",
			err:  errors.New("connection refused"),
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsConnectionNotExists(tt.err); got != tt.want {
				t.Errorf("IsConnectionNotExists(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}
