package main

import (
	"strings"
	"testing"
)

func TestThreeWaitersResume(t *testing.T) {
	if err := run(false); err != nil {
		t.Fatalf("waiter scenario failed: %v", err)
	}
}

func TestSnapshotReportsMissingWaiter(t *testing.T) {
	_, err := snapshotWaiters([]target{{"missing.waiter", "[chan receive]"}}, 0)
	if err == nil || !strings.Contains(err.Error(), "could not observe") {
		t.Fatalf("expected a bounded observation error, got %v", err)
	}
}
