package conditions

import (
	"fmt"

	mariadbv1alpha1 "github.com/mariadb-operator/mariadb-operator/v26/api/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func SetPrimarySwitching(c Conditioner, newPrimary string) {
	msg := fmt.Sprintf(
		"Switching primary to '%s'",
		newPrimary,
	)
	c.SetCondition(metav1.Condition{
		Type:    mariadbv1alpha1.ConditionTypeReady,
		Status:  metav1.ConditionFalse,
		Reason:  mariadbv1alpha1.ConditionReasonSwitchPrimary,
		Message: msg,
	})
	c.SetCondition(metav1.Condition{
		Type:    mariadbv1alpha1.ConditionTypePrimarySwitched,
		Status:  metav1.ConditionFalse,
		Reason:  mariadbv1alpha1.ConditionReasonSwitchPrimary,
		Message: msg,
	})
}

func SetPrimarySwitched(c Conditioner) {
	c.SetCondition(metav1.Condition{
		Type:    mariadbv1alpha1.ConditionTypePrimarySwitched,
		Status:  metav1.ConditionTrue,
		Reason:  mariadbv1alpha1.ConditionReasonSwitchPrimary,
		Message: "Switchover complete",
	})
}

// SetNewPrimaryConfigured records that newPrimary has already been made writable during an
// in-progress switchover, so a retry can resume past the phases that got it there instead of
// restarting the whole sequence.
func SetNewPrimaryConfigured(c Conditioner, newPrimary string) {
	c.SetCondition(metav1.Condition{
		Type:    mariadbv1alpha1.ConditionTypeNewPrimaryConfigured,
		Status:  metav1.ConditionTrue,
		Reason:  mariadbv1alpha1.ConditionReasonSwitchPrimary,
		Message: mariadbv1alpha1.NewPrimaryConfiguredMessage(newPrimary),
	})
}

func SetPrimarySwitchoverTimeout(c Conditioner, elapsed string) {
	c.SetCondition(metav1.Condition{
		Type:    mariadbv1alpha1.ConditionTypePrimarySwitched,
		Status:  metav1.ConditionTrue,
		Reason:  mariadbv1alpha1.ConditionReasonSwitchoverTimeout,
		Message: fmt.Sprintf("Switchover timed out after %s, reverted to previous primary", elapsed),
	})
}

// SetReplicationSyncing marks the Wait sync switchover phase as failing/retrying. Calling this
// repeatedly across retries is a no-op status-wise (LastTransitionTime only moves on the first
// call), which is what lets the cumulative Wait sync retry clock be derived from it.
func SetReplicationSyncing(c Conditioner) {
	c.SetCondition(metav1.Condition{
		Type:    mariadbv1alpha1.ConditionTypeReplicationSyncing,
		Status:  metav1.ConditionFalse,
		Reason:  mariadbv1alpha1.ConditionReasonReplicationSyncing,
		Message: "Waiting for replicas to sync with primary during switchover",
	})
}

// SetReplicationSynced clears the Wait sync retry clock: called when the Wait sync phase
// succeeds, and when a switchover is aborted or reset, so the next attempt starts fresh.
func SetReplicationSynced(c Conditioner) {
	c.SetCondition(metav1.Condition{
		Type:    mariadbv1alpha1.ConditionTypeReplicationSyncing,
		Status:  metav1.ConditionTrue,
		Reason:  mariadbv1alpha1.ConditionReasonReplicationSynced,
		Message: "Replicas synced with primary",
	})
}
