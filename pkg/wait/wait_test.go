package wait

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-logr/logr"
	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

// TestPollWithMariaDB_NotFoundKeepsPolling is a regression test for the bug fixed
// in PollWithMariaDB: when the referenced MariaDB does not exist, the function must
// keep retrying (surfacing a non-nil error) instead of silently reporting success
// on the very first poll iteration without ever invoking fn.
//
// PollUntilSuccessOrContextCancel polls with immediate=true and a 1s interval, so:
//   - the buggy version returned nil (success) on the first, immediate check and
//     PollUntilContextCancel returned almost instantly with a nil error.
//   - the fixed version returns a non-nil error on that first check, so
//     PollUntilContextCancel does not stop there; it waits for the next 1s tick,
//     which never arrives before our short context timeout expires.
//
// We use a context timeout shorter than the poll interval (100ms < 1s) and assert
// both that PollWithMariaDB returns a non-nil error AND that it took close to the
// full timeout to do so, which distinguishes "genuinely kept polling and then hit
// the context deadline" from "returned some unrelated immediate error".
func TestPollWithMariaDB_NotFoundKeepsPolling(t *testing.T) {
	scheme := runtime.NewScheme()
	utilruntime.Must(clientgoscheme.AddToScheme(scheme))
	utilruntime.Must(mariadbv1alpha1.AddToScheme(scheme))

	// No MariaDB object registered: Get() will return NotFound.
	fakeClient := fake.NewClientBuilder().WithScheme(scheme).Build()

	mariadbKey := types.NamespacedName{Namespace: "test", Name: "does-not-exist"}

	var fnCalled atomic.Bool
	fn := func(ctx context.Context) error {
		fnCalled.Store(true)
		return nil
	}

	const timeout = 100 * time.Millisecond
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	start := time.Now()
	err := PollWithMariaDB(ctx, mariadbKey, fakeClient, logr.Discard(), fn)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatalf("expected PollWithMariaDB to return a non-nil error when MariaDB is not found, got nil (elapsed=%s)", elapsed)
	}

	if elapsed < 80*time.Millisecond {
		t.Fatalf("expected PollWithMariaDB to keep polling until the context deadline (~%s), but it returned after only %s, "+
			"suggesting it succeeded immediately without retrying (regression of the fixed bug)", timeout, elapsed)
	}

	if fnCalled.Load() {
		t.Fatalf("expected fn to never be called when MariaDB is not found, but it was called")
	}
}
