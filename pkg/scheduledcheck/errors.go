package scheduledcheck

import "strings"

// Bounded set of "error" label values for PodNetworkStatusGauge. Kept small and fixed on
// purpose — see the gauge's doc comment for why the raw error string must never be used as a
// label value.
const (
	errCategoryTimeout           = "timeout"
	errCategoryConnectionRefused = "connection_refused"
	errCategoryConnectionReset   = "connection_reset"
	errCategoryDNS               = "dns_error"
	errCategoryAuth              = "auth_error"
	errCategoryOther             = "other"
)

// classifyError maps a SQL connection error down to a small, fixed set of categories suitable for
// use as a Prometheus label value. The full error is still available in the operator logs (every
// call site also logs it via logger.Error) for anyone who needs the specific detail; only the
// metric label is bounded.
//
// This matches on substrings of the error message rather than error type assertions
// (errors.As/errors.Is) because the errors flowing through pkg/sql are wrapped with fmt.Errorf's
// %v, not %w, at multiple points (e.g. ClientSet.ClientForIndex), which discards the ability to
// unwrap to the underlying net/mysql error types.
func classifyError(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	switch {
	case strings.Contains(msg, "i/o timeout"), strings.Contains(msg, "context deadline exceeded"):
		return errCategoryTimeout
	case strings.Contains(msg, "connection refused"):
		return errCategoryConnectionRefused
	case strings.Contains(msg, "connection reset"):
		return errCategoryConnectionReset
	case strings.Contains(msg, "no such host"), strings.Contains(msg, "lookup "):
		return errCategoryDNS
	case strings.Contains(msg, "Access denied"):
		return errCategoryAuth
	default:
		return errCategoryOther
	}
}
