package scheduledcheck

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

// TestClassifyError_BoundedCategories is a regression test for the finding that using a raw
// error string as a Prometheus label value (PodNetworkStatusGauge's "error" label) grows the
// TSDB's cardinality without bound, since connection error strings vary with IP/port/timing
// details. classifyError must always collapse any error into one of a small, fixed set of
// categories.
func TestClassifyError_BoundedCategories(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want string
	}{
		{"nil error", nil, ""},
		{"dial timeout", errors.New("dial tcp 10.2.3.4:3306: i/o timeout"), errCategoryTimeout},
		{"context deadline exceeded", fmt.Errorf("error pinging database: %v", context.DeadlineExceeded), errCategoryTimeout},
		{"connection refused", errors.New("dial tcp 10.2.3.4:3306: connect: connection refused"), errCategoryConnectionRefused},
		{"connection reset", errors.New("read tcp 10.2.3.4:3306: read: connection reset by peer"), errCategoryConnectionReset},
		{"dns error", errors.New(`dial tcp: lookup mariadb-0.mariadb-internal.default.svc: no such host`), errCategoryDNS},
		{"auth error", errors.New("Error 1045 (28000): Access denied for user 'root'@'10.2.3.4' (using password: YES)"), errCategoryAuth},
		{"unrecognized error falls back to other", errors.New("something unexpected happened"), errCategoryOther},
		{
			"wrapped error (fmt.Errorf %v, matching how pkg/sql wraps these) still classifies correctly",
			fmt.Errorf("error creating replica '0' client: %v", errors.New("dial tcp 10.2.3.4:3306: connect: connection refused")),
			errCategoryConnectionRefused,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := classifyError(tt.err); got != tt.want {
				t.Errorf("classifyError(%v) = %q, want %q", tt.err, got, tt.want)
			}
		})
	}
}

// TestClassifyError_AllCategoriesAreBounded is a coarser guard on the same property: no matter
// what garbage/PII-laden error text is fed in, the result must be one of the fixed categories
// (or empty for nil), never the raw input echoed back.
func TestClassifyError_AllCategoriesAreBounded(t *testing.T) {
	allowed := map[string]bool{
		"":                           true,
		errCategoryTimeout:           true,
		errCategoryConnectionRefused: true,
		errCategoryConnectionReset:   true,
		errCategoryDNS:               true,
		errCategoryAuth:              true,
		errCategoryOther:             true,
	}
	inputs := []error{
		nil,
		errors.New("192.168.1.100:3306 some very specific message with an embedded IP"),
		errors.New("panic: unexpected nil pointer at 0xC0001234"),
		errors.New(""),
	}
	for _, err := range inputs {
		got := classifyError(err)
		if !allowed[got] {
			t.Errorf("classifyError(%v) = %q, which is not one of the bounded categories", err, got)
		}
	}
}
