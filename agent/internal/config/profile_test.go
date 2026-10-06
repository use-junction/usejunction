package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestConfigDirRespectsUSEJUNCTION_HOME(t *testing.T) {
	ResetRuntimeForTest()
	t.Setenv(homeEnv, "")
	t.Setenv(profileEnv, "")
	dir := t.TempDir()
	t.Setenv(homeEnv, dir)
	t.Cleanup(ResetRuntimeForTest)
	got := ConfigDir()
	if got != dir {
		t.Fatalf("ConfigDir() = %q, want %q", got, dir)
	}
}

func TestDefaultLocalSyncPortForTestProfile(t *testing.T) {
	ResetRuntimeForTest()
	t.Setenv(homeEnv, "")
	t.Setenv(profileEnv, "test")
	t.Cleanup(ResetRuntimeForTest)

	if got := DefaultLocalSyncPortForProfile(); got != DefaultLocalSyncPortTest {
		t.Fatalf("DefaultLocalSyncPortForProfile() = %d, want %d", got, DefaultLocalSyncPortTest)
	}
}

func TestApplyRuntimeProfileTest(t *testing.T) {
	ResetRuntimeForTest()
	t.Setenv(homeEnv, "")
	t.Setenv(profileEnv, "")
	t.Cleanup(ResetRuntimeForTest)

	if err := ApplyRuntimeProfile("", "test"); err != nil {
		t.Fatal(err)
	}
	home, _ := os.UserHomeDir()
	want := filepath.Join(home, TestHomeDirName)
	if ConfigDir() != want {
		t.Fatalf("ConfigDir() = %q, want %q", ConfigDir(), want)
	}
}

func TestServiceIdentityForTestProfile(t *testing.T) {
	id := identityForHome("/Users/dev/.usejunction-test")
	if id.LaunchdLabel != "com.usejunction.agent.test" {
		t.Fatalf("LaunchdLabel = %q", id.LaunchdLabel)
	}
	if id.CLIName != "usejunction-test" {
		t.Fatalf("CLIName = %q", id.CLIName)
	}
}

func TestAppBundlePathIsVisibleApplications(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	id := identityForHome("/Users/dev/.usejunction")
	want := filepath.Join(home, "Applications", "UseJunction.app")
	if got := id.AppBundlePath(); got != want {
		t.Fatalf("AppBundlePath() = %q, want %q", got, want)
	}
	if got := id.DaemonBinaryPath(); got != filepath.Join(want, "Contents", "MacOS", "usejunction") {
		t.Fatalf("DaemonBinaryPath() = %q", got)
	}
	if got := id.PreviousAppBundlePath(); got != filepath.Join(home, "Applications", "UseJunction.previous.app") {
		t.Fatalf("PreviousAppBundlePath() = %q", got)
	}
}

func TestLegacyAppBundlePathStaysUnderConfigDir(t *testing.T) {
	id := identityForHome("/Users/dev/.usejunction")
	configDir := "/tmp/custom-home"
	want := filepath.Join(configDir, "UseJunction.app")
	if got := id.LegacyAppBundlePath(configDir); got != want {
		t.Fatalf("LegacyAppBundlePath() = %q, want %q", got, want)
	}
	if got := id.CLISymlinkPath(configDir); got != filepath.Join(configDir, "bin", "usejunction") {
		t.Fatalf("CLISymlinkPath() = %q", got)
	}
}

func TestAppBundlePathIgnoresUSEJUNCTION_HOME(t *testing.T) {
	ResetRuntimeForTest()
	t.Setenv(homeEnv, "")
	t.Setenv(profileEnv, "")
	dir := t.TempDir()
	t.Setenv(homeEnv, dir)
	t.Cleanup(ResetRuntimeForTest)

	if ConfigDir() != dir {
		t.Fatalf("ConfigDir() = %q, want %q", ConfigDir(), dir)
	}
	id := CurrentServiceIdentity()
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(home, "Applications", id.AppName+".app")
	if got := id.AppBundlePath(); got != want {
		t.Fatalf("AppBundlePath() followed data home: got %q want %q", got, want)
	}
}

func TestTestProfileAppBundleIsIsolated(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	id := identityForHome("/Users/dev/.usejunction-test")
	want := filepath.Join(home, "Applications", "UseJunctionTest.app")
	if got := id.AppBundlePath(); got != want {
		t.Fatalf("test AppBundlePath() = %q, want %q", got, want)
	}
}
