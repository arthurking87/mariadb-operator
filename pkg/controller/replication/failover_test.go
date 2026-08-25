package replication

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/go-logr/logr"
	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	pkgreplication "github.com/mariadb-operator/mariadb-operator/v26/pkg/replication"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

// listErrorClient wraps a client.Client and forces every List call to fail with
// the configured error, regardless of what is being listed. It is used to simulate
// a transient failure (e.g. API server unreachable) while listing secondary Pods,
// as opposed to a successful list that simply finds no viable candidates.
type listErrorClient struct {
	client.Client
	err error
}

func (c *listErrorClient) List(ctx context.Context, list client.ObjectList, opts ...client.ListOption) error {
	return c.err
}

func newFailoverTestScheme(t *testing.T) *runtime.Scheme {
	t.Helper()
	scheme := runtime.NewScheme()
	if err := corev1.AddToScheme(scheme); err != nil {
		t.Fatalf("error adding corev1 to scheme: %v", err)
	}
	if err := mariadbv1alpha1.AddToScheme(scheme); err != nil {
		t.Fatalf("error adding mariadbv1alpha1 to scheme: %v", err)
	}
	return scheme
}

func newFailoverTestMariaDB(namespace string, primaryPodIndex *int) *mariadbv1alpha1.MariaDB {
	return &mariadbv1alpha1.MariaDB{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "mariadb-test",
			Namespace: namespace,
		},
		Status: mariadbv1alpha1.MariaDBStatus{
			CurrentPrimaryPodIndex: primaryPodIndex,
		},
	}
}

// TestFurthestAdvancedReplica_NoSecondaryPods proves that when there are simply no
// secondary Pods to promote (the expected, "nothing to do yet" case), the returned
// error is the ErrNoFailoverCandidate sentinel, matched via errors.Is. Callers rely
// on this to keep monitoring instead of erroring out.
func TestFurthestAdvancedReplica_NoSecondaryPods(t *testing.T) {
	scheme := newFailoverTestScheme(t)
	c := fake.NewClientBuilder().WithScheme(scheme).Build()
	mdb := newFailoverTestMariaDB("test-ns", ptr.To(0))

	handler := NewFailoverHandler(c, mdb, logr.Discard())

	_, err := handler.FurthestAdvancedReplica(context.Background())
	if err == nil {
		t.Fatal("expected an error, got nil")
	}
	if !errors.Is(err, ErrNoFailoverCandidate) {
		t.Fatalf("expected errors.Is(err, ErrNoFailoverCandidate) to be true, got err=%v", err)
	}
}

// TestFurthestAdvancedReplica_TransientListError proves that a transient failure while
// listing secondary Pods (e.g. API server temporarily unreachable) is NOT reported as
// ErrNoFailoverCandidate. Callers rely on errors.Is being false here to propagate the
// error and requeue-with-backoff, instead of silently treating it as "no candidate".
func TestFurthestAdvancedReplica_TransientListError(t *testing.T) {
	scheme := newFailoverTestScheme(t)
	base := fake.NewClientBuilder().WithScheme(scheme).Build()
	injected := errors.New("connection refused")
	c := &listErrorClient{Client: base, err: injected}
	mdb := newFailoverTestMariaDB("test-ns", ptr.To(0))

	handler := NewFailoverHandler(c, mdb, logr.Discard())

	_, err := handler.FurthestAdvancedReplica(context.Background())
	if err == nil {
		t.Fatal("expected an error, got nil")
	}
	if errors.Is(err, ErrNoFailoverCandidate) {
		t.Fatalf("did not expect errors.Is(err, ErrNoFailoverCandidate) to be true for a transient list error, got err=%v", err)
	}
	if !strings.Contains(err.Error(), injected.Error()) {
		t.Fatalf("expected error to contain the underlying list error %q, got %q", injected.Error(), err.Error())
	}
}

// TestFurthestAdvancedReplica_MissingPrimaryPodIndex proves that a completely different
// kind of error (missing required status field, a caller/config error) is also not
// mistaken for ErrNoFailoverCandidate, reinforcing that the sentinel is reserved
// specifically for "listed successfully, found nobody healthy enough to promote".
func TestFurthestAdvancedReplica_MissingPrimaryPodIndex(t *testing.T) {
	scheme := newFailoverTestScheme(t)
	c := fake.NewClientBuilder().WithScheme(scheme).Build()
	mdb := newFailoverTestMariaDB("test-ns", nil)

	handler := NewFailoverHandler(c, mdb, logr.Discard())

	_, err := handler.FurthestAdvancedReplica(context.Background())
	if err == nil {
		t.Fatal("expected an error, got nil")
	}
	if errors.Is(err, ErrNoFailoverCandidate) {
		t.Fatalf("did not expect a config error to match ErrNoFailoverCandidate, got err=%v", err)
	}
}

// TestFurthestAdvancedCandidate_NoneHaveGtidPosition proves the underlying helper used by
// FurthestAdvancedReplica returns nil (feeding the second ErrNoFailoverCandidate wrap site,
// "no furthest advanced candidate was found") when none of the candidates have a usable
// GTID position to compare.
func TestFurthestAdvancedCandidate_NoneHaveGtidPosition(t *testing.T) {
	h := &FailoverHandler{logger: logr.Discard()}
	candidates := []promotionCandidate{
		{name: "mariadb-1"},
		{name: "mariadb-2"},
	}

	got := h.furthestAdvancedCandidate(candidates)
	if got != nil {
		t.Fatalf("expected nil, got %+v", got)
	}
}

// TestFurthestAdvancedCandidate_PicksFurthestAdvanced sanity-checks that, given viable
// candidates, the helper actually picks the one with the greatest GTID position rather
// than always returning nil.
func TestFurthestAdvancedCandidate_PicksFurthestAdvanced(t *testing.T) {
	h := &FailoverHandler{logger: logr.Discard()}
	candidates := []promotionCandidate{
		{name: "mariadb-1", gtidCurrentPos: &pkgreplication.Gtid{DomainID: 0, ServerID: 1, SequenceID: 5}},
		{name: "mariadb-2", gtidCurrentPos: &pkgreplication.Gtid{DomainID: 0, ServerID: 1, SequenceID: 42}},
	}

	got := h.furthestAdvancedCandidate(candidates)
	if got == nil {
		t.Fatal("expected a candidate, got nil")
	}
	if got.name != "mariadb-2" {
		t.Fatalf("expected mariadb-2 to be furthest advanced, got %q", got.name)
	}
}
