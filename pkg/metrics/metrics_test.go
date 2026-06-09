package metrics

import (
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
	dto "github.com/prometheus/client_model/go"
)

const (
	labelSuccess = "success"
	labelFailure = "failure"
)

// newIsolatedRegistry builds a fresh prometheus registry and registers all
// metrics under test into it. This avoids interference with the global
// ctrlmetrics.Registry that init() populates.
func newIsolatedRegistry(t *testing.T) *prometheus.Registry {
	t.Helper()
	reg := prometheus.NewRegistry()
	reg.MustRegister(
		SwitchoverDuration,
		SwitchoverLastDuration,
		SwitchoverPhaseDuration,
		SwitchoverPhaseLastDuration,
	)
	return reg
}

// descLabels returns the variable label names from a Collector's descriptor.
// Desc.String() format: "Desc{..., variableLabels: {a,b,c}}"
func descLabels(c prometheus.Collector) []string {
	ch := make(chan *prometheus.Desc, 1)
	c.Describe(ch)
	close(ch)
	d := <-ch
	s := d.String()
	const marker = "variableLabels: {"
	start := strings.Index(s, marker)
	if start == -1 {
		return nil
	}
	start += len(marker)
	end := strings.Index(s[start:], "}")
	if end == -1 {
		return nil
	}
	raw := strings.TrimSpace(s[start : start+end])
	if raw == "" {
		return nil
	}
	return strings.Split(raw, ",")
}

// metricMatchesLabels returns true if every key/value in want is present in m's labels.
func metricMatchesLabels(m *dto.Metric, want map[string]string) bool {
	got := make(map[string]string, len(m.GetLabel()))
	for _, lp := range m.GetLabel() {
		got[lp.GetName()] = lp.GetValue()
	}
	for k, v := range want {
		if got[k] != v {
			return false
		}
	}
	return true
}

// TestMetricDescriptors validates the actual package-level metric definitions:
// label names and label counts. This catches renames or additions to labels in
// metrics.go that local-var tests would miss.
func TestMetricDescriptors(t *testing.T) {
	tests := []struct {
		name       string
		collector  prometheus.Collector
		wantLabels []string
	}{
		{
			name:       "SwitchoverDuration",
			collector:  SwitchoverDuration,
			wantLabels: []string{"namespace", "mariadb", "result"},
		},
		{
			name:       "SwitchoverLastDuration",
			collector:  SwitchoverLastDuration,
			wantLabels: []string{"namespace", "mariadb"},
		},
		{
			name:       "SwitchoverPhaseDuration",
			collector:  SwitchoverPhaseDuration,
			wantLabels: []string{"namespace", "mariadb", "phase", "result"},
		},
		{
			name:       "SwitchoverPhaseLastDuration",
			collector:  SwitchoverPhaseLastDuration,
			wantLabels: []string{"namespace", "mariadb", "phase"},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := descLabels(tc.collector)
			if len(got) != len(tc.wantLabels) {
				t.Fatalf("label count: want %v, got %v", tc.wantLabels, got)
			}
			for i, want := range tc.wantLabels {
				if got[i] != want {
					t.Errorf("label[%d]: want %q, got %q", i, want, got[i])
				}
			}
		})
	}
}

func TestSwitchoverMetricsRegistered(t *testing.T) {
	// Verify each metric is accessible and has the correct label arity.
	// WithLabelValues panics if the number of labels doesn't match the descriptor.
	collectors := []func(){
		func() { SwitchoverDuration.WithLabelValues("ns", "mdb", labelSuccess) },
		func() { SwitchoverLastDuration.WithLabelValues("ns", "mdb") },
		func() { SwitchoverPhaseDuration.WithLabelValues("ns", "mdb", "phase", labelSuccess) },
		func() { SwitchoverPhaseLastDuration.WithLabelValues("ns", "mdb", "phase") },
	}
	for _, fn := range collectors {
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("metric accessor panicked: %v", r)
				}
			}()
			fn()
		}()
	}

	// Also verify all metrics can be registered together in an isolated registry
	// without name collisions — MustRegister panics on duplicate registration.
	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("MustRegister panicked (duplicate name?): %v", r)
			}
		}()
		newIsolatedRegistry(t)
	}()
}

func TestSwitchoverLastDuration_UpdatesNotAccumulates(t *testing.T) {
	// GaugeVec.Set() must overwrite the previous value, not add to it.
	gauge := prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "test_switchover_last_duration_seconds",
	}, []string{"namespace", "mariadb"})

	const ns, mdb = "default", "mariadb-test"

	gauge.WithLabelValues(ns, mdb).Set(10.0)
	gauge.WithLabelValues(ns, mdb).Set(5.0) // must overwrite, not add

	got := testutil.ToFloat64(gauge.WithLabelValues(ns, mdb))
	if got != 5.0 {
		t.Errorf("last duration gauge: want 5.0 (updated), got %v (accumulated)", got)
	}
}

func TestSwitchoverPhaseLastDuration_UpdatesNotAccumulates(t *testing.T) {
	gauge := prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "test_phase_last_duration_seconds",
	}, []string{"namespace", "mariadb", "phase"})

	const ns, mdb, phase = "default", "mariadb-test", "wait_sync"

	gauge.WithLabelValues(ns, mdb, phase).Set(3.0)
	gauge.WithLabelValues(ns, mdb, phase).Set(1.5)

	got := testutil.ToFloat64(gauge.WithLabelValues(ns, mdb, phase))
	if got != 1.5 {
		t.Errorf("phase last duration gauge: want 1.5 (updated), got %v (accumulated)", got)
	}
}

func TestSwitchoverDuration_SameLabelSeriesReused(t *testing.T) {
	// Multiple Observe() calls on the same label combination must update the
	// same series (count increases), not create new series.
	hist := prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "test_switchover_duration_seconds",
		Buckets: []float64{1, 5, 10},
	}, []string{"namespace", "mariadb", "result"})

	const ns, mdb = "default", "mariadb-test"

	hist.WithLabelValues(ns, mdb, labelSuccess).Observe(2.0)
	hist.WithLabelValues(ns, mdb, labelSuccess).Observe(4.0)

	reg := prometheus.NewRegistry()
	reg.MustRegister(hist)

	const expected = `
# HELP test_switchover_duration_seconds
# TYPE test_switchover_duration_seconds histogram
test_switchover_duration_seconds_bucket{mariadb="mariadb-test",namespace="default",result="success",le="1"} 0
test_switchover_duration_seconds_bucket{mariadb="mariadb-test",namespace="default",result="success",le="5"} 2
test_switchover_duration_seconds_bucket{mariadb="mariadb-test",namespace="default",result="success",le="10"} 2
test_switchover_duration_seconds_bucket{mariadb="mariadb-test",namespace="default",result="success",le="+Inf"} 2
test_switchover_duration_seconds_sum{mariadb="mariadb-test",namespace="default",result="success"} 6
test_switchover_duration_seconds_count{mariadb="mariadb-test",namespace="default",result="success"} 2
`
	if err := testutil.GatherAndCompare(reg, strings.NewReader(expected),
		"test_switchover_duration_seconds"); err != nil {
		t.Errorf("histogram series mismatch: %v", err)
	}
}

func TestSwitchoverPhaseDuration_BucketsCoverLongSyncTimeout(t *testing.T) {
	// SyncTimeout is user-configurable and may exceed the default 10s.
	// Verify the histogram has buckets that cover at least 60s and 120s so
	// observations from long-running wait_sync phases don't all land in +Inf.
	const (
		targetNS    = "buckettest-ns"
		targetMDB   = "buckettest-mdb"
		targetPhase = "wait_sync"
	)

	reg := prometheus.NewRegistry()
	reg.MustRegister(SwitchoverPhaseDuration)
	SwitchoverPhaseDuration.WithLabelValues(targetNS, targetMDB, targetPhase, labelSuccess).Observe(90.0)

	mfs, err := reg.Gather()
	if err != nil {
		t.Fatalf("gather: %v", err)
	}

	for _, mf := range mfs {
		if mf.GetName() != "mariadb_operator_switchover_phase_duration_seconds" {
			continue
		}
		for _, m := range mf.GetMetric() {
			if !metricMatchesLabels(m, map[string]string{
				"namespace": targetNS, "mariadb": targetMDB, "phase": targetPhase, "result": labelSuccess,
			}) {
				continue
			}
			var found60, found120, captured bool
			for _, b := range m.GetHistogram().GetBucket() {
				if b.GetUpperBound() == 60 {
					found60 = true
				}
				if b.GetUpperBound() == 120 {
					found120 = true
					if b.GetCumulativeCount() > 0 {
						captured = true
					}
				}
			}
			if !found60 {
				t.Error("SwitchoverPhaseDuration missing 60s bucket")
			}
			if !found120 {
				t.Error("SwitchoverPhaseDuration missing 120s bucket")
			}
			if !captured {
				t.Error("90s observation not captured by 120s bucket")
			}
			return
		}
	}
	t.Error("target series not found in gathered metrics")
}

func TestSwitchoverMetrics_MultipleInstances_IndependentSeries(t *testing.T) {
	// Two different MariaDB instances must produce independent series.
	hist := prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "test_multi_switchover_duration_seconds",
		Buckets: []float64{1, 5, 10},
	}, []string{"namespace", "mariadb", "result"})

	hist.WithLabelValues("ns1", "mdb-a", labelSuccess).Observe(2.0)
	hist.WithLabelValues("ns1", "mdb-a", labelSuccess).Observe(3.0)
	hist.WithLabelValues("ns2", "mdb-b", labelSuccess).Observe(1.0)

	reg := prometheus.NewRegistry()
	reg.MustRegister(hist)
	mfs, err := reg.Gather()
	if err != nil {
		t.Fatalf("gather: %v", err)
	}
	var seriesCount int
	for _, mf := range mfs {
		seriesCount += len(mf.GetMetric())
	}
	if seriesCount != 2 {
		t.Errorf("want 2 independent series, got %d", seriesCount)
	}
}
