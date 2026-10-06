package install

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/usejunction/agent/internal/config"
)

func TestNeedsRelocate(t *testing.T) {
	configDir := filepath.Join(t.TempDir(), ".usejunction")
	hidden := filepath.Join(configDir, "UseJunction.app", "Contents", "MacOS", "usejunction")
	visible := filepath.Join(t.TempDir(), "Applications", "UseJunction.app", "Contents", "MacOS", "usejunction")

	if !NeedsRelocate(hidden, visible, configDir) {
		t.Fatal("expected relocate from hidden config dir")
	}
	if NeedsRelocate(visible, visible, configDir) {
		t.Fatal("already-visible binary should not relocate")
	}
	if NeedsRelocate(visible, hidden, configDir) {
		t.Fatal("binary outside config dir should not relocate")
	}
}

func TestRelocateIfNeededCopiesBundleAndRewritesPlist(t *testing.T) {
	root := t.TempDir()
	configDir := filepath.Join(root, ".usejunction")
	userHome := filepath.Join(root, "home")
	srcBundle := filepath.Join(configDir, "UseJunction.app")
	srcBin := filepath.Join(srcBundle, "Contents", "MacOS", "usejunction")
	if err := os.MkdirAll(filepath.Dir(srcBin), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(srcBin, []byte("fake-daemon"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcBundle, "Contents", "Info.plist"), []byte("<plist></plist>"), 0o644); err != nil {
		t.Fatal(err)
	}

	destBundle := filepath.Join(root, "Applications", "UseJunction.app")
	id := config.AgentServiceIdentity{
		LaunchdLabel: "com.usejunction.agent",
		LaunchdPlist: "com.usejunction.agent.plist",
		AppName:      "UseJunction",
		CLIName:      "usejunction",
	}

	var restartedPlist string
	restarted, err := RelocateIfNeeded(RelocateInput{
		Executable:     srcBin,
		UserHome:       userHome,
		ConfigDir:      configDir,
		Identity:       id,
		TargetBundle:   destBundle,
		PreviousBundle: destBundle + ".previous",
		Restart: func(home, plist string) error {
			restartedPlist = plist
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !restarted {
		t.Fatal("expected restart after relocate")
	}

	newBin := filepath.Join(destBundle, "Contents", "MacOS", "usejunction")
	if _, err := os.Stat(newBin); err != nil {
		t.Fatalf("visible bundle missing: %v", err)
	}
	body, err := os.ReadFile(newBin)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "fake-daemon" {
		t.Fatalf("copied binary = %q", body)
	}

	plist := filepath.Join(userHome, "Library", "LaunchAgents", id.LaunchdPlist)
	if restartedPlist != plist {
		t.Fatalf("restart plist = %q want %q", restartedPlist, plist)
	}
	xml, err := os.ReadFile(plist)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(xml), newBin) {
		t.Fatalf("plist does not point at visible binary:\n%s", xml)
	}
	if !strings.Contains(string(xml), "<key>KeepAlive</key>") {
		t.Fatal("plist missing KeepAlive")
	}
	if strings.Contains(string(xml), "--profile") {
		t.Fatal("default profile plist should not pass --profile test")
	}

	link := filepath.Join(configDir, "bin", "usejunction")
	got, err := os.Readlink(link)
	if err != nil {
		t.Fatal(err)
	}
	if got != newBin {
		t.Fatalf("CLI symlink = %q want %q", got, newBin)
	}

	// Hidden source is left in place until the new process cleans it up.
	if _, err := os.Stat(srcBin); err != nil {
		t.Fatal("relocate should copy, not delete, the running bundle")
	}
}

func TestRelocateIfNeededTestProfileArgs(t *testing.T) {
	root := t.TempDir()
	configDir := filepath.Join(root, ".usejunction-test")
	srcBin := filepath.Join(configDir, "UseJunctionTest.app", "Contents", "MacOS", "usejunction")
	if err := os.MkdirAll(filepath.Dir(srcBin), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(srcBin, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	destBundle := filepath.Join(root, "Applications", "UseJunctionTest.app")
	id := config.AgentServiceIdentity{
		LaunchdLabel: "com.usejunction.agent.test",
		LaunchdPlist: "com.usejunction.agent.test.plist",
		AppName:      "UseJunctionTest",
		CLIName:      "usejunction-test",
	}
	if _, err := RelocateIfNeeded(RelocateInput{
		Executable:   srcBin,
		UserHome:     filepath.Join(root, "home"),
		ConfigDir:    configDir,
		Identity:     id,
		TargetBundle: destBundle,
		Restart:      func(string, string) error { return nil },
	}); err != nil {
		t.Fatal(err)
	}
	xml, err := os.ReadFile(filepath.Join(root, "home", "Library", "LaunchAgents", id.LaunchdPlist))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(xml), "--profile") || !strings.Contains(string(xml), "test") {
		t.Fatalf("test plist missing profile args:\n%s", xml)
	}
}

func TestRelocateIfNeededNoopWhenAlreadyVisible(t *testing.T) {
	root := t.TempDir()
	configDir := filepath.Join(root, ".usejunction")
	destBundle := filepath.Join(root, "Applications", "UseJunction.app")
	bin := filepath.Join(destBundle, "Contents", "MacOS", "usejunction")
	if err := os.MkdirAll(filepath.Dir(bin), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bin, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	restarted, err := RelocateIfNeeded(RelocateInput{
		Executable:   bin,
		ConfigDir:    configDir,
		TargetBundle: destBundle,
		Identity:     config.AgentServiceIdentity{AppName: "UseJunction"},
		Restart: func(string, string) error {
			t.Fatal("restart should not run")
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if restarted {
		t.Fatal("visible path should not relocate")
	}
}

func TestCleanupLegacyBundles(t *testing.T) {
	root := t.TempDir()
	configDir := filepath.Join(root, ".usejunction")
	legacy := filepath.Join(configDir, "UseJunction.app")
	if err := os.MkdirAll(filepath.Join(legacy, "Contents"), 0o755); err != nil {
		t.Fatal(err)
	}
	visible := filepath.Join(root, "Applications", "UseJunction.app")
	exe := filepath.Join(visible, "Contents", "MacOS", "usejunction")
	id := config.AgentServiceIdentity{AppName: "UseJunction"}

	if err := cleanupLegacyBundles(exe, visible, configDir, id); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Fatal("expected hidden leftover bundle to be removed")
	}
}

func TestCleanupLegacyBundlesSkipsWhileStillHidden(t *testing.T) {
	root := t.TempDir()
	configDir := filepath.Join(root, ".usejunction")
	legacy := filepath.Join(configDir, "UseJunction.app")
	exe := filepath.Join(legacy, "Contents", "MacOS", "usejunction")
	if err := os.MkdirAll(filepath.Dir(exe), 0o755); err != nil {
		t.Fatal(err)
	}
	visible := filepath.Join(root, "Applications", "UseJunction.app")
	id := config.AgentServiceIdentity{AppName: "UseJunction"}
	if err := cleanupLegacyBundles(exe, visible, configDir, id); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(legacy); err != nil {
		t.Fatal("must not delete the running hidden bundle")
	}
}

func TestLaunchdPlistXMLEscapesPaths(t *testing.T) {
	xml := launchdPlistXML("com.usejunction.agent", []string{`/tmp/a&b/usejunction`, "daemon"}, "/tmp/out", "/tmp/err")
	if !strings.Contains(xml, `/tmp/a&amp;b/usejunction`) {
		t.Fatalf("expected escaped path, got:\n%s", xml)
	}
}
