package cmd

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/usejunction/agent/internal/client"
	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/updater"
)

var (
	updateCheck    bool
	updateRollback bool
	updateForce    bool
)

var updateCmd = &cobra.Command{
	Use:   "update",
	Short: "Check, install, or roll back the UseJunction agent",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := requireConfig()
		if err != nil {
			return err
		}
		api := client.New(cfg)
		if updateRollback {
			stopBackgroundAgent()
			if err := updater.Rollback(cfg, api, ""); err != nil {
				startBackgroundAgent()
				return err
			}
			if err := restartBackgroundAgent(); err != nil {
				return fmt.Errorf("rollback installed but daemon restart failed: %w", err)
			}
			fmt.Println("Rolled back the UseJunction agent. The rejected version is blocked until a newer release or --force.")
			return nil
		}

		directive, err := api.CheckAgentUpdate()
		if err != nil {
			return err
		}
		if directive == nil {
			if format == "json" {
				printJSON(map[string]any{"updateAvailable": false, "currentVersion": config.Version})
			} else {
				fmt.Printf("UseJunction agent v%s is current.\n", config.Version)
			}
			return nil
		}
		if updateCheck {
			if format == "json" {
				printJSON(map[string]any{"updateAvailable": true, "currentVersion": config.Version, "targetVersion": directive.TargetVersion, "urgency": directive.Urgency})
			} else {
				fmt.Printf("Update available: v%s → v%s (%s).\n", config.Version, directive.TargetVersion, directive.Urgency)
			}
			return nil
		}

		stopBackgroundAgent()
		updated, err := updater.Apply(cmd.Context(), cfg, updater.ApplyOptions{
			Directive: *directive, CurrentVersion: config.Version, ControlPlaneURL: cfg.ControlPlaneURL,
			Reporter: api, Force: updateForce,
		})
		if errors.Is(err, updater.ErrBlockedVersion) {
			startBackgroundAgent()
			return fmt.Errorf("version %s is blocked after rollback; use --force to reinstall it", directive.TargetVersion)
		}
		if err != nil {
			startBackgroundAgent()
			return err
		}
		if !updated {
			startBackgroundAgent()
			return nil
		}
		// Legacy installs still under ~/.usejunction converge to ~/Applications as
		// part of the update rather than on every daemon boot.
		if migrateDarwinBundleAfterUpdate() {
			fmt.Printf("Installed UseJunction agent v%s and moved it to ~/Applications. The background service is restarting.\n", directive.TargetVersion)
			return nil
		}
		if err := restartBackgroundAgent(); err != nil {
			return fmt.Errorf("update installed but daemon restart failed: %w", err)
		}
		fmt.Printf("Installed UseJunction agent v%s. The background service is restarting.\n", directive.TargetVersion)
		return nil
	},
}

// stopBackgroundAgent unloads/stops the background service so binary replacement
// cannot leave a stale process running from a renamed previous path.
func stopBackgroundAgent() {
	home, _ := os.UserHomeDir()
	id := config.CurrentServiceIdentity()
	switch runtime.GOOS {
	case "darwin":
		domain := fmt.Sprintf("gui/%d", os.Getuid())
		plist := id.LaunchdPlistPath(home)
		if err := exec.Command("launchctl", "bootout", domain, plist).Run(); err != nil {
			_ = exec.Command("launchctl", "unload", plist).Run()
		}
	case "linux":
		_ = exec.Command("systemctl", "--user", "stop", id.SystemdUnit).Run()
	case "windows":
		_ = exec.Command("powershell.exe", "-NoProfile", "-Command", fmt.Sprintf("Stop-ScheduledTask -TaskName '%s' -ErrorAction SilentlyContinue", id.WindowsTaskName)).Run()
	}
}

// startBackgroundAgent reloads the service after a failed update/rollback attempt.
func startBackgroundAgent() {
	home, _ := os.UserHomeDir()
	id := config.CurrentServiceIdentity()
	switch runtime.GOOS {
	case "darwin":
		domain := fmt.Sprintf("gui/%d", os.Getuid())
		plist := id.LaunchdPlistPath(home)
		if err := exec.Command("launchctl", "bootstrap", domain, plist).Run(); err != nil {
			_ = exec.Command("launchctl", "load", plist).Run()
		}
	case "linux":
		_ = exec.Command("systemctl", "--user", "start", id.SystemdUnit).Run()
	case "windows":
		_ = exec.Command("powershell.exe", "-NoProfile", "-Command", fmt.Sprintf("Start-ScheduledTask -TaskName '%s' -ErrorAction SilentlyContinue", id.WindowsTaskName)).Run()
	}
}

func restartBackgroundAgent() error {
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "darwin":
		if err := restartDarwinLaunchAgent(home); err != nil {
			return err
		}
		// kickstart -k terminates the launchd job. When the daemon invokes this
		// during self-update it may already be exiting; skip PID verification.
		if isDaemonProcess() {
			return nil
		}
		return verifyDarwinDaemonExecutable(home)
	case "linux":
		id := config.CurrentServiceIdentity()
		if err := exec.CommandContext(context.Background(), "systemctl", "--user", "restart", id.SystemdUnit).Run(); err != nil {
			return err
		}
		return nil
	case "windows":
		// The Windows updater launches a detached handoff because the running
		// executable is locked. That handoff restarts the Scheduled Task.
		return nil
	default:
		return fmt.Errorf("automatic restart is unsupported on %s", runtime.GOOS)
	}
}

func isDaemonProcess() bool {
	for _, arg := range os.Args[1:] {
		if arg == "daemon" {
			return true
		}
	}
	return false
}

func restartDarwinLaunchAgent(home string) error {
	uid := os.Getuid()
	domain := fmt.Sprintf("gui/%d", uid)
	id := config.CurrentServiceIdentity()
	label := domain + "/" + id.LaunchdLabel
	plist := id.LaunchdPlistPath(home)
	if _, err := os.Stat(plist); err != nil {
		return fmt.Errorf("launchd plist not found at %s", plist)
	}

	if err := exec.Command("launchctl", "kickstart", "-k", label).Run(); err == nil {
		return nil
	}

	// Job may have been booted out (manual update path). Never bare-load alone.
	_ = exec.Command("launchctl", "bootout", domain, plist).Run()
	if err := exec.Command("launchctl", "bootstrap", domain, plist).Run(); err != nil {
		_ = exec.Command("launchctl", "unload", plist).Run()
		if err := exec.Command("launchctl", "load", plist).Run(); err != nil {
			return fmt.Errorf("launchctl bootstrap/load failed: %w", err)
		}
	}
	_ = exec.Command("launchctl", "kickstart", "-k", label).Run()
	return nil
}

func verifyDarwinDaemonExecutable(home string) error {
	deadline := time.Now().Add(5 * time.Second)
	id := config.CurrentServiceIdentity()
	configDir := config.ConfigDir()
	appBinary := id.DaemonBinaryPath()
	previousMarker := id.PreviousAppBundlePath()
	legacyPrevious := filepath.Join(configDir, id.AppName+".app.previous")
	legacyHiddenPrevious := filepath.Join(configDir, id.AppName+".previous.app")

	for time.Now().Before(deadline) {
		out, err := exec.Command("ps", "-ax", "-o", "command=").Output()
		if err != nil {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		lines := strings.Split(string(out), "\n")
		runningApp := false
		stalePrevious := false
		for _, line := range lines {
			if !strings.Contains(line, "usejunction") || !strings.Contains(line, "daemon") {
				continue
			}
			if strings.Contains(line, previousMarker) || strings.Contains(line, legacyPrevious) || strings.Contains(line, legacyHiddenPrevious) || strings.Contains(line, id.AppName+".previous.app") || strings.Contains(line, id.AppName+".app.previous") {
				stalePrevious = true
				continue
			}
			if strings.Contains(line, appBinary) || strings.Contains(line, id.LegacyAppBundlePath(configDir)) || strings.Contains(line, id.AppName+".app/Contents/MacOS/usejunction") {
				runningApp = true
			}
		}
		if stalePrevious {
			return fmt.Errorf("stale agent still running from %s.previous.app; kickstart failed to replace the process", id.AppName)
		}
		if runningApp {
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("daemon did not come up from %s after restart", appBinary)
}

func init() {
	updateCmd.Flags().BoolVar(&updateCheck, "check", false, "Check for an update without installing it")
	updateCmd.Flags().BoolVar(&updateRollback, "rollback", false, "Restore the previous agent binary")
	updateCmd.Flags().BoolVar(&updateForce, "force", false, "Install a version blocked after rollback")
	rootCmd.AddCommand(updateCmd)
}
