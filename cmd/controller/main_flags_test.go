package main

import (
	"testing"
)

// TestLeaderElectionIDFlag_Default verifies that the --leader-election-id flag is
// registered on rootCmd with the expected default value. This guards against
// accidentally removing the flag registration or reverting to the previously
// hardcoded LeaderElectionID string.
func TestLeaderElectionIDFlag_Default(t *testing.T) {
	flag := rootCmd.Flags().Lookup("leader-election-id")
	if flag == nil {
		t.Fatal("expected rootCmd to have a --leader-election-id flag registered")
	}
	const wantDefault = "mariadb-operator.mariadb.com"
	if flag.DefValue != wantDefault {
		t.Errorf("unexpected default value for --leader-election-id: got %q, want %q", flag.DefValue, wantDefault)
	}
}

// TestLeaderElectionIDFlag_Parse verifies that passing --leader-election-id on
// rootCmd correctly overrides the package-level leaderElectionID variable.
func TestLeaderElectionIDFlag_Parse(t *testing.T) {
	const defaultValue = "mariadb-operator.mariadb.com"

	t.Cleanup(func() {
		// Reset flag state so this test doesn't leak into other tests in the package.
		if err := rootCmd.Flags().Set("leader-election-id", defaultValue); err != nil {
			t.Fatalf("failed to reset --leader-election-id flag: %v", err)
		}
		leaderElectionID = defaultValue
	})

	if err := rootCmd.ParseFlags([]string{"--leader-election-id=custom-id"}); err != nil {
		t.Fatalf("failed to parse --leader-election-id flag: %v", err)
	}

	if leaderElectionID != "custom-id" {
		t.Errorf("unexpected leaderElectionID after parsing flag: got %q, want %q", leaderElectionID, "custom-id")
	}
}

// TestCertControllerLeaderElectionIDFlag_Default verifies that the
// --leader-election-id flag is registered on certControllerCmd with the expected
// default value.
func TestCertControllerLeaderElectionIDFlag_Default(t *testing.T) {
	flag := certControllerCmd.Flags().Lookup("leader-election-id")
	if flag == nil {
		t.Fatal("expected certControllerCmd to have a --leader-election-id flag registered")
	}
	const wantDefault = "cert-controller.mariadb-operator.mariadb.com"
	if flag.DefValue != wantDefault {
		t.Errorf("unexpected default value for certControllerCmd --leader-election-id: got %q, want %q", flag.DefValue, wantDefault)
	}
}

// TestCertControllerLeaderElectionIDFlag_Parse verifies that passing
// --leader-election-id on certControllerCmd correctly overrides the package-level
// certControllerLeaderElectionID variable.
func TestCertControllerLeaderElectionIDFlag_Parse(t *testing.T) {
	const defaultValue = "cert-controller.mariadb-operator.mariadb.com"

	t.Cleanup(func() {
		if err := certControllerCmd.Flags().Set("leader-election-id", defaultValue); err != nil {
			t.Fatalf("failed to reset certControllerCmd --leader-election-id flag: %v", err)
		}
		certControllerLeaderElectionID = defaultValue
	})

	if err := certControllerCmd.ParseFlags([]string{"--leader-election-id=custom-cert-id"}); err != nil {
		t.Fatalf("failed to parse certControllerCmd --leader-election-id flag: %v", err)
	}

	if certControllerLeaderElectionID != "custom-cert-id" {
		t.Errorf("unexpected certControllerLeaderElectionID after parsing flag: got %q, want %q",
			certControllerLeaderElectionID, "custom-cert-id")
	}
}
