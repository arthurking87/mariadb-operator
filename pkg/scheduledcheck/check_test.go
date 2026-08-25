package scheduledcheck

import (
	"errors"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestBoolToFloat(t *testing.T) {
	if got := boolToFloat(true); got != 1 {
		t.Errorf("want 1, got %v", got)
	}
	if got := boolToFloat(false); got != 0 {
		t.Errorf("want 0, got %v", got)
	}
}

func TestConditionStatusToFloat(t *testing.T) {
	tests := []struct {
		status metav1.ConditionStatus
		want   float64
	}{
		{metav1.ConditionTrue, 1},
		{metav1.ConditionFalse, 0},
		{metav1.ConditionUnknown, -1},
	}
	for _, tc := range tests {
		if got := conditionStatusToFloat(tc.status); got != tc.want {
			t.Errorf("status %q: want %v, got %v", tc.status, tc.want, got)
		}
	}
}

func TestDomainIDsLabel(t *testing.T) {
	tests := []struct {
		name string
		ids  map[uint32]struct{}
		want string
	}{
		{"empty", map[uint32]struct{}{}, ""},
		{"single", map[uint32]struct{}{1: {}}, "1"},
		{"sorted multiple", map[uint32]struct{}{10: {}, 2: {}, 1: {}}, "1,10,2"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := domainIDsLabel(tc.ids); got != tc.want {
				t.Errorf("want %q, got %q", tc.want, got)
			}
		})
	}
}

func TestParseUnixTimestamp(t *testing.T) {
	got, err := parseUnixTimestamp(float64(1700000000))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != 1700000000 {
		t.Errorf("want 1700000000, got %v", got)
	}

	if _, err := parseUnixTimestamp("not-a-number"); err == nil {
		t.Error("want error for non-numeric input, got nil")
	}
}

// TestParseUnixTimestamp_NilIsAbsentNotAnError is a regression test: password_last_changed is
// legitimately absent for accounts using a non-password auth plugin (e.g. unix_socket for
// root@localhost), which checkRootPasswordAge must treat as "skip this account", not as a check
// failure to report on PodRootPasswordFreshGauge.
func TestParseUnixTimestamp_NilIsAbsentNotAnError(t *testing.T) {
	_, err := parseUnixTimestamp(nil)
	if err == nil {
		t.Fatal("want a sentinel error for a nil value, got nil error")
	}
	if !errors.Is(err, errPasswordLastChangedAbsent) {
		t.Errorf("want errors.Is(err, errPasswordLastChangedAbsent) to hold, got: %v", err)
	}
}
