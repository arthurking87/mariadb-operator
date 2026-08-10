package replication

import "testing"

// TestReplicaConnectionNamesAreNamedAndDistinct is a regression guard for issue #40.
// Intra-cluster replication must use a real named replication channel
// (ReplicaConnectionName) rather than falling back to MariaDB's default/legacy unnamed
// connection. If either of these variables were ever reset to the empty string, the
// call sites in pkg/controller/replication would silently start operating on the
// default connection again, which is exactly the condition that produced dual
// replication channels (an Error 1934 connection conflict against the empty/default
// connection name) during KIND testing of the fix. It must also stay distinct from
// the multi-cluster channel name, since both can be configured on the same server
// simultaneously (multi-cluster primary-replica topology).
func TestReplicaConnectionNamesAreNamedAndDistinct(t *testing.T) {
	if ReplicaConnectionName == "" {
		t.Error("ReplicaConnectionName must not be empty: an empty value falls back to " +
			"MariaDB's default/legacy unnamed replication connection")
	}
	if MultiClusterReplicaConnectionName == "" {
		t.Error("MultiClusterReplicaConnectionName must not be empty: an empty value falls back to " +
			"MariaDB's default/legacy unnamed replication connection")
	}
	if ReplicaConnectionName == MultiClusterReplicaConnectionName {
		t.Errorf("ReplicaConnectionName and MultiClusterReplicaConnectionName must be distinct channels, "+
			"both were %q", ReplicaConnectionName)
	}
}
