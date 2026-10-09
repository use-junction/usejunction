package cmd

import (
	"os"
	"path/filepath"
	"testing"
)

// TestMigrateDarwinBundleAfterUpdateNoopWhenNotHidden guards the critical safety
// property of the transitional post-update migration: when the running agent is
// not under the hidden data home it must do nothing — no bundle copy, no
// LaunchAgent rewrite, no launchctl restart. The test binary never lives under
// the configured home, so this exercises the no-op path on every OS (on non
// darwin it returns false via the GOOS guard; on darwin NeedsRelocate is false).
func TestMigrateDarwinBundleAfterUpdateNoopWhenNotHidden(t *testing.T) {
	home := t.TempDir()
	// Point the agent data home at an empty temp dir the test binary is not under.
	t.Setenv("USEJUNCTION_HOME", filepath.Join(home, ".usejunction"))

	if migrateDarwinBundleAfterUpdate() {
		t.Fatal("migrateDarwinBundleAfterUpdate relocated an agent that is not in the hidden dir")
	}

	// No Applications bundle should have been created as a side effect.
	if entries, err := os.ReadDir(filepath.Join(home, "Applications")); err == nil && len(entries) > 0 {
		t.Fatalf("migration created an app bundle unexpectedly: %v", entries)
	}
}

// TestMaybeCleanupLegacyDarwinBundlesSafeWhenNotVisible verifies the boot-time
// cleanup is inert when the agent is not running from ~/Applications (the test
// binary never is), so it is safe to call on every daemon start.
func TestMaybeCleanupLegacyDarwinBundlesSafeWhenNotVisible(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USEJUNCTION_HOME", filepath.Join(home, ".usejunction"))
	// Must not panic or error out the daemon start path.
	maybeCleanupLegacyDarwinBundles()
}
