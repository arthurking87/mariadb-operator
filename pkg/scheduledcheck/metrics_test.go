package scheduledcheck

import (
	"testing"

	"github.com/prometheus/client_golang/prometheus/testutil"
)

// TestMetricsBatch_ApplyPublishesBufferedValues verifies the basic contract: values passed to
// set are not visible on the real gauge until apply is called.
func TestMetricsBatch_ApplyPublishesBufferedValues(t *testing.T) {
	MariadbReadyGauge.Reset()
	defer MariadbReadyGauge.Reset()

	b := newMetricsBatch()
	b.set(MariadbReadyGauge, 1, "op-ns", "op-name", "default", "test-mdb")

	if got := testutil.ToFloat64(MariadbReadyGauge.WithLabelValues("op-ns", "op-name", "default", "test-mdb")); got != 0 {
		t.Errorf("expected gauge to be unset (0) before apply, got %v", got)
	}

	b.apply()

	if got := testutil.ToFloat64(MariadbReadyGauge.WithLabelValues("op-ns", "op-name", "default", "test-mdb")); got != 1 {
		t.Errorf("expected gauge to be 1 after apply, got %v", got)
	}
}

// TestMetricsBatch_UnappliedBatchLeavesPreviousStateIntact is a regression test for the finding
// that resetting the gauges up front (before a scan starts) and refilling them in place over the
// whole scan lets a concurrent Prometheus scrape observe an emptied-out state for however long the
// scan takes. It also covers Runnable.runCheck's behavior on a scan that times out partway
// through: since it never calls apply() in that case, the previous tick's values (simulated here
// by an earlier, separate apply() call) must remain exactly as they were — not reset, not
// partially overwritten.
func TestMetricsBatch_UnappliedBatchLeavesPreviousStateIntact(t *testing.T) {
	MariadbReadyGauge.Reset()
	defer MariadbReadyGauge.Reset()

	previous := newMetricsBatch()
	previous.set(MariadbReadyGauge, 1, "op-ns", "op-name", "default", "test-mdb")
	previous.apply()

	// Simulate a new scan starting (e.g. the next tick) that buffers a different value for the
	// same series but never finishes (its apply() is never called, as Runnable.runCheck does
	// when tickCtx times out).
	inFlight := newMetricsBatch()
	inFlight.set(MariadbReadyGauge, 0, "op-ns", "op-name", "default", "test-mdb")

	if got := testutil.ToFloat64(MariadbReadyGauge.WithLabelValues("op-ns", "op-name", "default", "test-mdb")); got != 1 {
		t.Errorf("expected the previous tick's value (1) to remain untouched by an unapplied batch, got %v", got)
	}
}

// TestMetricsBatch_ApplyResetsSeriesNotInTheNewBatch verifies that apply's reset-then-refill
// actually drops series that no longer appear in the new batch (e.g. a MariaDB CR that was
// deleted between ticks), not just overwrite the ones present.
func TestMetricsBatch_ApplyResetsSeriesNotInTheNewBatch(t *testing.T) {
	MariadbReadyGauge.Reset()
	defer MariadbReadyGauge.Reset()

	first := newMetricsBatch()
	first.set(MariadbReadyGauge, 1, "op-ns", "op-name", "default", "deleted-mdb")
	first.apply()

	second := newMetricsBatch()
	second.set(MariadbReadyGauge, 1, "op-ns", "op-name", "default", "still-here-mdb")
	second.apply()

	if got := testutil.ToFloat64(MariadbReadyGauge.WithLabelValues("op-ns", "op-name", "default", "deleted-mdb")); got != 0 {
		t.Errorf("expected the deleted MariaDB's series to be gone (reset to the zero/absent value 0) after apply, got %v", got)
	}
	if got := testutil.ToFloat64(MariadbReadyGauge.WithLabelValues("op-ns", "op-name", "default", "still-here-mdb")); got != 1 {
		t.Errorf("expected the still-present MariaDB's series to be 1, got %v", got)
	}
}
