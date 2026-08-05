package main

import (
	"testing"

	ctrl "sigs.k8s.io/controller-runtime"
)

// fakeManager embeds a nil ctrl.Manager and only overrides Elected(), since
// leaderElectionReadyzCheck only ever calls that method on the manager.
type fakeManager struct {
	ctrl.Manager // embedded nil interface; fine since only Elected() is called
	elected      chan struct{}
}

func (f *fakeManager) Elected() <-chan struct{} {
	return f.elected
}

func TestLeaderElectionReadyzCheck(t *testing.T) {
	cases := []struct {
		name    string
		enabled bool
		elected bool
		wantErr bool
	}{
		{
			name:    "disabled leader election always reports ready",
			enabled: false,
			elected: false,
			wantErr: false,
		},
		{
			name:    "enabled leader election, not yet elected reports not ready",
			enabled: true,
			elected: false,
			wantErr: true,
		},
		{
			name:    "enabled leader election, elected reports ready",
			enabled: true,
			elected: true,
			wantErr: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			electedCh := make(chan struct{})
			if tc.elected {
				close(electedCh)
			}
			mgr := &fakeManager{elected: electedCh}

			checker := leaderElectionReadyzCheck(mgr, tc.enabled)
			err := checker(nil)

			if tc.wantErr && err == nil {
				t.Fatalf("expected an error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("expected no error, got: %v", err)
			}
		})
	}
}
