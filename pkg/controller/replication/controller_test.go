package replication

import (
	"testing"

	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	"k8s.io/utils/ptr"
)

func TestReplicationConfigHash(t *testing.T) {
	baseMariadb := func() *mariadbv1alpha1.MariaDB {
		return &mariadbv1alpha1.MariaDB{
			Spec: mariadbv1alpha1.MariaDBSpec{
				Port: 3306,
				Replication: &mariadbv1alpha1.Replication{
					ReplicationSpec: mariadbv1alpha1.ReplicationSpec{
						Replica: mariadbv1alpha1.ReplicaReplication{
							Gtid:                   ptr.To(mariadbv1alpha1.GtidCurrentPos),
							ConnectionRetrySeconds: ptr.To(5),
							ReplPasswordSecretKeyRef: &mariadbv1alpha1.GeneratedSecretKeyRef{
								SecretKeySelector: mariadbv1alpha1.SecretKeySelector{
									LocalObjectReference: mariadbv1alpha1.LocalObjectReference{
										Name: "repl-password",
									},
									Key: "password",
								},
							},
						},
					},
				},
			},
		}
	}

	tests := []struct {
		name      string
		mutate    func(*mariadbv1alpha1.MariaDB)
		wantEqual bool
	}{
		{
			name:      "no changes",
			mutate:    func(m *mariadbv1alpha1.MariaDB) {},
			wantEqual: true,
		},
		{
			name: "connectionRetrySeconds changed",
			mutate: func(m *mariadbv1alpha1.MariaDB) {
				m.Spec.Replication.Replica.ConnectionRetrySeconds = ptr.To(30)
			},
			wantEqual: false,
		},
		{
			name: "gtid mode changed",
			mutate: func(m *mariadbv1alpha1.MariaDB) {
				m.Spec.Replication.Replica.Gtid = ptr.To(mariadbv1alpha1.GtidSlavePos)
			},
			wantEqual: false,
		},
		{
			name: "port changed",
			mutate: func(m *mariadbv1alpha1.MariaDB) {
				m.Spec.Port = 3307
			},
			wantEqual: false,
		},
		{
			name: "repl password secret changed",
			mutate: func(m *mariadbv1alpha1.MariaDB) {
				m.Spec.Replication.Replica.ReplPasswordSecretKeyRef.Name = "other-secret"
			},
			wantEqual: false,
		},
		{
			// Regression test: syncBinlogPrimary/syncBinlogReplica/innodbFlushLogAtTrxCommitPrimary/
			// innodbFlushLogAtTrxCommitReplica are applied via ConfigurePrimary/ConfigureReplica
			// (see setPrimaryDurability/setReplicaDurability in topology.go), so changing them must
			// be reflected in the hash, otherwise configChanged stays false and the new values only
			// take effect on the next switchover/failover.
			name: "syncBinlogPrimary changed",
			mutate: func(m *mariadbv1alpha1.MariaDB) {
				m.Spec.Replication.SyncBinlogPrimary = ptr.To(int32(0))
			},
			wantEqual: false,
		},
		{
			name: "syncBinlogReplica changed",
			mutate: func(m *mariadbv1alpha1.MariaDB) {
				m.Spec.Replication.SyncBinlogReplica = ptr.To(int32(0))
			},
			wantEqual: false,
		},
		{
			name: "innodbFlushLogAtTrxCommitPrimary changed",
			mutate: func(m *mariadbv1alpha1.MariaDB) {
				m.Spec.Replication.InnodbFlushLogAtTrxCommitPrimary = ptr.To(int32(2))
			},
			wantEqual: false,
		},
		{
			name: "innodbFlushLogAtTrxCommitReplica changed",
			mutate: func(m *mariadbv1alpha1.MariaDB) {
				m.Spec.Replication.InnodbFlushLogAtTrxCommitReplica = ptr.To(int32(0))
			},
			wantEqual: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			original := baseMariadb()
			wantHash, err := replicationConfigHash(original)
			if err != nil {
				t.Fatalf("unexpected error hashing original spec: %v", err)
			}

			mutated := baseMariadb()
			tt.mutate(mutated)
			gotHash, err := replicationConfigHash(mutated)
			if err != nil {
				t.Fatalf("unexpected error hashing mutated spec: %v", err)
			}

			if tt.wantEqual && wantHash != gotHash {
				t.Errorf("expected hashes to be equal, got %q and %q", wantHash, gotHash)
			}
			if !tt.wantEqual && wantHash == gotHash {
				t.Errorf("expected hashes to differ, both were %q", wantHash)
			}
		})
	}
}
