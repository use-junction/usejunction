package uninstall

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/configure"
)

// Run restores tool configs, removes agent data, and stops background services.
func Run(verbose bool) error {
	fmt.Println("Restoring legacy tool config backups…")
	if err := configure.UnconfigureAll(); err != nil && verbose {
		fmt.Printf("  warning: %v\n", err)
	}

	removeCliFromPath()
	deferred, err := schedulePlatformCleanup()
	if err != nil {
		return err
	}
	if deferred {
		stopServices()
		fmt.Println("Scheduled agent cleanup after this process exits.")
		fmt.Println("UseJunction agent uninstalled.")
		return nil
	}

	stopServices()
	removeDarwinAppBundles()
	fmt.Printf("Removing %s…\n", config.ConfigDir())
	_ = os.RemoveAll(config.ConfigDir())

	fmt.Println("UseJunction agent uninstalled.")
	return nil
}

func stopServices() {
	home, _ := os.UserHomeDir()
	id := config.CurrentServiceIdentity()
	switch runtime.GOOS {
	case "darwin":
		plist := id.LaunchdPlistPath(home)
		_ = exec.Command("launchctl", "unload", plist).Run()
		_ = os.Remove(plist)
		fmt.Println("Removed launchd plist.")
	case "linux":
		unitFile := filepath.Join(home, ".config", "systemd", "user", id.SystemdUnit)
		_ = exec.Command("systemctl", "--user", "disable", "--now", id.SystemdUnit).Run()
		_ = os.Remove(unitFile)
		fmt.Println("Removed systemd user service.")
	}
}

func removeDarwinAppBundles() {
	if runtime.GOOS != "darwin" {
		return
	}
	id := config.CurrentServiceIdentity()
	configDir := config.ConfigDir()
	for _, p := range []string{
		id.AppBundlePath(),
		id.PreviousAppBundlePath(),
		id.LegacyAppBundlePath(configDir),
		filepath.Join(configDir, id.AppName+".previous.app"),
		filepath.Join(configDir, id.AppName+".app.previous"),
		filepath.Join(configDir, "UseJunction Agent.app"),
	} {
		_ = os.RemoveAll(p)
	}
}
