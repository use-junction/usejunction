//go:build !windows

package uninstall

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"

	"github.com/usejunction/agent/internal/config"
)

func schedulePlatformCleanup() (bool, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return false, err
	}
	id := config.CurrentServiceIdentity()
	rootDir := config.ConfigDir()

	file, err := os.CreateTemp("", "usejunction-uninstall-*.sh")
	if err != nil {
		return false, err
	}
	scriptPath := file.Name()

	var script string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		plist := id.LaunchdPlistPath(home)
		appDir := id.AppBundlePath()
		previousApp := id.PreviousAppBundlePath()
		script = `#!/bin/sh
set -eu
parent_pid="$1"
root_dir="$2"
plist="$3"
app_dir="$4"
previous_app="$5"
i=0
while [ "$i" -lt 120 ]; do
  if ! kill -0 "$parent_pid" 2>/dev/null; then
    break
  fi
  i=$((i + 1))
  sleep 0.25
done
launchctl unload "$plist" 2>/dev/null || true
rm -f "$plist"
rm -rf "$root_dir"
rm -rf "$app_dir"
rm -rf "$previous_app"
rm -f "$0"
`
		args = []string{scriptPath, strconv.Itoa(os.Getpid()), rootDir, plist, appDir, previousApp}
	case "linux":
		unit := id.SystemdUnit
		unitFile := filepath.Join(home, ".config", "systemd", "user", unit)
		script = `#!/bin/sh
set -eu
parent_pid="$1"
root_dir="$2"
unit="$3"
unit_file="$4"
i=0
while [ "$i" -lt 120 ]; do
  if ! kill -0 "$parent_pid" 2>/dev/null; then
    break
  fi
  i=$((i + 1))
  sleep 0.25
done
systemctl --user disable --now "$unit" 2>/dev/null || true
rm -f "$unit_file"
rm -rf "$root_dir"
rm -f "$0"
`
		args = []string{scriptPath, strconv.Itoa(os.Getpid()), rootDir, unit, unitFile}
	default:
		_ = file.Close()
		_ = os.Remove(scriptPath)
		return false, nil
	}

	if _, err := file.WriteString(script); err != nil {
		_ = file.Close()
		_ = os.Remove(scriptPath)
		return false, err
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(scriptPath)
		return false, err
	}
	if err := os.Chmod(scriptPath, 0o700); err != nil {
		_ = os.Remove(scriptPath)
		return false, err
	}

	cmd := exec.Command("/bin/sh", args...)
	if err := cmd.Start(); err != nil {
		_ = os.Remove(scriptPath)
		return false, fmt.Errorf("start unix uninstall handoff: %w", err)
	}
	_ = cmd.Process.Release()
	return true, nil
}
