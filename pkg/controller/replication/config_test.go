package replication

import (
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"
	env "github.com/mariadb-operator/mariadb-operator/v26/pkg/environment"
	"k8s.io/utils/ptr"
)

func TestNewReplicationConfig(t *testing.T) {
	tests := []struct {
		name       string
		env        *env.PodEnvironment
		wantConfig string
		wantErr    bool
	}{
		{
			name: "replication disabled",
			env: &env.PodEnvironment{
				PodName:            "mariadb-0",
				MariadbName:        "mariadb",
				MariaDBReplEnabled: "foo",
			},
			wantErr: true,
		},
		{
			name: "invalid GTID strict mode",
			env: &env.PodEnvironment{
				PodName:                   "mariadb-0",
				MariadbName:               "mariadb",
				MariaDBReplEnabled:        "true",
				MariaDBReplGtidStrictMode: "foo",
			},
			wantErr: true,
		},
		{
			name: "invalid semi-sync enabled",
			env: &env.PodEnvironment{
				PodName:                    "mariadb-0",
				MariadbName:                "mariadb",
				MariaDBReplEnabled:         "true",
				MariaDBReplSemiSyncEnabled: "foo",
			},
			wantErr: true,
		},
		{
			name: "invalid semi-sync master timeout",
			env: &env.PodEnvironment{
				PodName:                          "mariadb-0",
				MariadbName:                      "mariadb",
				MariaDBReplEnabled:               "true",
				MariaDBReplSemiSyncMasterTimeout: "foo",
			},
			wantErr: true,
		},
		{
			name: "invalid master sync binlog",
			env: &env.PodEnvironment{
				PodName:                     "mariadb-0",
				MariadbName:                 "mariadb",
				MariaDBReplEnabled:          "true",
				MariaDBReplMasterSyncBinlog: "foo",
			},
			wantErr: true,
		},
		{
			name: "minimal replication enabled",
			env: &env.PodEnvironment{
				PodName:            "mariadb-0",
				MariadbName:        "mariadb",
				MariaDBReplEnabled: "true",
			},
			wantConfig: `[mariadb]
log_bin
log_basename=mariadb
`,
			wantErr: false,
		},
		{
			name: "minimal semi-sync replication enabled",
			env: &env.PodEnvironment{
				PodName:                    "mariadb-0",
				MariadbName:                "mariadb",
				MariaDBReplEnabled:         "true",
				MariaDBReplSemiSyncEnabled: "true",
			},
			wantConfig: `[mariadb]
log_bin
log_basename=mariadb
rpl_semi_sync_master_enabled=ON
rpl_semi_sync_slave_enabled=ON
`,
			wantErr: false,
		},
		{
			name: "missing semi-sync master timeout",
			env: &env.PodEnvironment{
				PodName:                            "mariadb-0",
				MariadbName:                        "mariadb",
				MariaDBReplEnabled:                 "true",
				MariaDBReplGtidStrictMode:          "true",
				MariaDBReplSemiSyncEnabled:         "true",
				MariaDBReplSemiSyncMasterWaitPoint: "AFTER_SYNC",
				MariaDBReplMasterSyncBinlog:        "1",
			},
			wantConfig: `[mariadb]
log_bin
log_basename=mariadb
gtid_strict_mode
rpl_semi_sync_master_enabled=ON
rpl_semi_sync_slave_enabled=ON
rpl_semi_sync_master_wait_point=AFTER_SYNC
sync_binlog=1
`,
			wantErr: false,
		},
		{
			name: "missing semi-sync master wait point",
			env: &env.PodEnvironment{
				PodName:                          "mariadb-0",
				MariadbName:                      "mariadb",
				MariaDBReplEnabled:               "true",
				MariaDBReplGtidStrictMode:        "true",
				MariaDBReplSemiSyncEnabled:       "true",
				MariaDBReplSemiSyncMasterTimeout: "5000",
				MariaDBReplMasterSyncBinlog:      "1",
			},
			wantConfig: `[mariadb]
log_bin
log_basename=mariadb
gtid_strict_mode
rpl_semi_sync_master_enabled=ON
rpl_semi_sync_slave_enabled=ON
rpl_semi_sync_master_timeout=5000
sync_binlog=1
`,
			wantErr: false,
		},
		{
			name: "with custom GTID domain ID",
			env: &env.PodEnvironment{
				PodName:                 "mariadb-0",
				MariadbName:             "mariadb",
				MariaDBReplEnabled:      "true",
				MariaDBReplGtidDomainID: "1",
			},
			wantConfig: `[mariadb]
log_bin
log_basename=mariadb
gtid_domain_id=1
`,
			wantErr: false,
		},
		{
			name: "all values present",
			env: &env.PodEnvironment{
				PodName:                            "mariadb-0",
				MariadbName:                        "mariadb",
				MariaDBReplEnabled:                 "true",
				MariaDBReplGtidStrictMode:          "true",
				MariaDBReplGtidDomainID:            "1",
				MariaDBReplSemiSyncEnabled:         "true",
				MariaDBReplSemiSyncMasterTimeout:   "5000",
				MariaDBReplSemiSyncMasterWaitPoint: "AFTER_SYNC",
				MariaDBReplMasterSyncBinlog:        "1",
			},
			wantConfig: `[mariadb]
log_bin
log_basename=mariadb
gtid_strict_mode
gtid_domain_id=1
rpl_semi_sync_master_enabled=ON
rpl_semi_sync_slave_enabled=ON
rpl_semi_sync_master_timeout=5000
rpl_semi_sync_master_wait_point=AFTER_SYNC
sync_binlog=1
`,
			wantErr: false,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			config, err := NewReplicationConfig(tt.env)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			// Compare as normalized strings (avoids surprises with newlines/whitespace)
			got := strings.TrimSpace(string(config))
			want := strings.TrimSpace(tt.wantConfig)

			if diff := cmp.Diff(want, got); diff != "" {
				t.Errorf("unexpected config (-want +got):\n%s", diff)
			}
		})
	}
}

func TestGtidDomainID(t *testing.T) {
	tests := []struct {
		name          string
		rawGtidDomain string
		want          *int
		wantErr       bool
	}{
		{
			name:          "empty string returns nil",
			rawGtidDomain: "",
			want:          nil,
			wantErr:       false,
		},
		{
			name:          "valid GTID domain ID zero",
			rawGtidDomain: "0",
			want:          ptr.To(0),
			wantErr:       false,
		},
		{
			name:          "valid GTID domain ID",
			rawGtidDomain: "42",
			want:          ptr.To(42),
			wantErr:       false,
		},
		{
			name:          "valid GTID domain ID large",
			rawGtidDomain: "999999",
			want:          ptr.To(999999),
			wantErr:       false,
		},
		{
			name:          "invalid string",
			rawGtidDomain: "foo",
			want:          nil,
			wantErr:       true,
		},
		{
			name:          "invalid float",
			rawGtidDomain: "3.14",
			want:          nil,
			wantErr:       true,
		},
		{
			name:          "invalid with whitespace",
			rawGtidDomain: " 42 ",
			want:          nil,
			wantErr:       true,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			got, err := gtidDomainID(tt.rawGtidDomain)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if tt.want == nil && got != nil {
				t.Fatalf("expected nil, got %v", *got)
			}
			if tt.want != nil && got == nil {
				t.Fatalf("expected %v, got nil", *tt.want)
			}
			if tt.want != nil && got != nil && *tt.want != *got {
				t.Errorf("expected %v, got %v", *tt.want, *got)
			}
		})
	}
}

