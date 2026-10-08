package cmd

import (
	"fmt"
	"os"
	"runtime"

	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/install"
)

// maybeCleanupLegacyDarwinBundles removes stale hidden-home *.app leftovers once
// the agent is already running from the visible ~/Applications path. This is
// plain file cleanup: it never copies the bundle or rewrites the LaunchAgent, so
// it is safe to run on every daemon start and is not the behavior EDR tools
// score as persistence_deception.
//
// The self-relocation that used to run on every daemon boot has moved to the
// update path (migrateDarwinBundleAfterUpdate). The resident daemon no longer
// rewrites its own persistence or copies its own bundle on boot.
func maybeCleanupLegacyDarwinBundles() {
	if runtime.GOOS != "darwin" {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		fmt.Printf("[daemon] legacy bundle cleanup skipped: %v\n", err)
		return
	}
	id := config.CurrentServiceIdentity()
	configDir := config.ConfigDir()
	if err := install.CleanupLegacyBundles(exe, id, configDir); err != nil {
		fmt.Printf("[daemon] legacy bundle cleanup warning: %v\n", err)
	}
}

// agentAppLocation reports where the running macOS agent binary lives so the
// control plane can flag legacy hidden-dir installs and prompt a repair:
// "legacyHidden" when it runs from ~/.usejunction, "visible" otherwise. Returns
// "" on non-darwin platforms, where the hidden-dir layout and the EDR concern do
// not apply.
func agentAppLocation() string {
	if runtime.GOOS != "darwin" {
		return ""
	}
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	id := config.CurrentServiceIdentity()
	configDir := config.ConfigDir()
	if install.NeedsRelocate(exe, id.DaemonBinaryPath(), configDir) {
		return "legacyHidden"
	}
	return "visible"
}

// migrateDarwinBundleAfterUpdate moves a just-updated agent out of the hidden
// ~/.usejunction data home into the visible ~/Applications bundle when it is
// still running from the legacy location, then restarts launchd from the visible
// path. It returns true when it relocated and restarted the service, so the
// caller should exit without issuing a second restart.
//
// TRANSITIONAL — remove once the fleet has converged. This exists only to move
// installs that predate the unhide. It runs after an update is applied (a
// bounded operation), never on every daemon boot, and reuses the exact restart
// sequence (restartDarwinLaunchAgent) that the former boot-time relocation
// already shipped, so it is no riskier than the deployed behavior. Once
// heartbeat telemetry (appLocation) shows no devices remain in the hidden dir,
// delete this function and its call sites; the installer/repair flow (install.sh)
// is the durable migration path.
func migrateDarwinBundleAfterUpdate() (restarted bool) {
	if runtime.GOOS != "darwin" {
		return false
	}
	exe, err := os.Executable()
	if err != nil {
		fmt.Printf("[update] relocate skipped: %v\n", err)
		return false
	}
	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Printf("[update] relocate skipped: %v\n", err)
		return false
	}
	id := config.CurrentServiceIdentity()
	configDir := config.ConfigDir()
	restarted, err = install.RelocateIfNeeded(install.RelocateInput{
		Executable: exe,
		UserHome:   home,
		ConfigDir:  configDir,
		Identity:   id,
		Restart: func(userHome, _ string) error {
			return restartDarwinLaunchAgent(userHome)
		},
	})
	if err != nil {
		fmt.Printf("[update] relocate warning: %v\n", err)
		return false
	}
	if restarted {
		fmt.Println("[update] moved app bundle to ~/Applications; restarting from visible path")
	}
	return restarted
}
