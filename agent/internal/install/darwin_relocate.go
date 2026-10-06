package install

import (
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/usejunction/agent/internal/config"
)

// RelocateInput describes a Darwin app-bundle move out of the hidden data home.
type RelocateInput struct {
	Executable     string
	UserHome       string
	ConfigDir      string
	Identity       config.AgentServiceIdentity
	TargetBundle   string
	PreviousBundle string
	Restart        func(userHome, plistPath string) error
}

// NeedsRelocate reports whether exe is the daemon running from the hidden
// ~/.usejunction (or test) app bundle rather than ~/Applications.
func NeedsRelocate(exe, targetBinary, configDir string) bool {
	if exe == "" || configDir == "" {
		return false
	}
	if samePath(exe, targetBinary) {
		return false
	}
	cleanExe := resolved(exe)
	cleanHome := resolved(configDir)
	sep := string(os.PathSeparator)
	return strings.HasPrefix(cleanExe, strings.TrimRight(cleanHome, sep)+sep)
}

// RelocateIfNeeded copies a hidden-home Darwin app bundle to ~/Applications,
// rewrites the LaunchAgent and CLI shim, and restarts launchd. restarted is
// true when the caller should exit so launchd can spawn the visible binary.
func RelocateIfNeeded(in RelocateInput) (restarted bool, err error) {
	if in.Executable == "" || in.ConfigDir == "" {
		return false, nil
	}
	destBundle := in.destBundle()
	targetBinary := filepath.Join(destBundle, "Contents", "MacOS", "usejunction")
	if !NeedsRelocate(in.Executable, targetBinary, in.ConfigDir) {
		return false, nil
	}
	srcBundle := enclosingAppBundle(in.Executable)
	if srcBundle == "" {
		return false, fmt.Errorf("could not find .app bundle for %s", in.Executable)
	}
	if samePath(srcBundle, destBundle) {
		return false, nil
	}

	if err := os.MkdirAll(filepath.Dir(destBundle), 0o755); err != nil {
		return false, fmt.Errorf("create Applications dir: %w", err)
	}
	staged := destBundle + ".new"
	_ = os.RemoveAll(staged)
	if err := copyDir(srcBundle, staged); err != nil {
		_ = os.RemoveAll(staged)
		return false, fmt.Errorf("copy app bundle: %w", err)
	}
	if err := swapAppBundle(staged, destBundle, in.previousBundle()); err != nil {
		_ = os.RemoveAll(staged)
		return false, err
	}

	newBinary := filepath.Join(destBundle, "Contents", "MacOS", "usejunction")
	plistPath := in.Identity.LaunchdPlistPath(in.UserHome)
	if err := WriteLaunchdPlist(plistPath, in.Identity, newBinary, in.ConfigDir); err != nil {
		return false, fmt.Errorf("write launchd plist: %w", err)
	}
	if err := linkCLI(in.Identity.CLISymlinkPath(in.ConfigDir), newBinary); err != nil {
		return false, fmt.Errorf("link CLI: %w", err)
	}

	restart := in.Restart
	if restart == nil {
		restart = restartLaunchAgent
	}
	if err := restart(in.UserHome, plistPath); err != nil {
		return false, fmt.Errorf("restart launchd: %w", err)
	}
	return true, nil
}

func (in RelocateInput) destBundle() string {
	if in.TargetBundle != "" {
		return in.TargetBundle
	}
	return in.Identity.AppBundlePath()
}

func (in RelocateInput) previousBundle() string {
	if in.PreviousBundle != "" {
		return in.PreviousBundle
	}
	return in.Identity.PreviousAppBundlePath()
}

// CleanupLegacyBundles removes hidden-home .app leftovers once the daemon is
// running from the visible ~/Applications path.
func CleanupLegacyBundles(exe string, id config.AgentServiceIdentity, configDir string) error {
	return cleanupLegacyBundles(exe, id.AppBundlePath(), configDir, id)
}

func cleanupLegacyBundles(exe, visibleBundle, configDir string, id config.AgentServiceIdentity) error {
	if !runningFromVisibleBundle(exe, visibleBundle) {
		return nil
	}
	var first error
	for _, p := range []string{
		id.LegacyAppBundlePath(configDir),
		filepath.Join(configDir, id.AppName+".previous.app"),
		filepath.Join(configDir, id.AppName+".app.previous"),
		filepath.Join(configDir, "UseJunction Agent.app"),
	} {
		if p == "" || samePath(p, visibleBundle) {
			continue
		}
		if err := os.RemoveAll(p); err != nil && first == nil {
			first = err
		}
	}
	return first
}

func runningFromVisibleBundle(exe, visibleBundle string) bool {
	if exe == "" || visibleBundle == "" {
		return false
	}
	target := filepath.Join(visibleBundle, "Contents", "MacOS", "usejunction")
	if samePath(exe, target) {
		return true
	}
	return strings.Contains(resolved(exe), resolved(visibleBundle))
}

// WriteLaunchdPlist writes the user LaunchAgent that runs the Darwin daemon.
func WriteLaunchdPlist(plistPath string, id config.AgentServiceIdentity, binary, configDir string) error {
	if err := os.MkdirAll(filepath.Dir(plistPath), 0o755); err != nil {
		return err
	}
	args := []string{binary, "daemon"}
	if config.IsTestHomeDir(configDir) {
		args = []string{binary, "--profile", "test", "daemon"}
	}
	logOut := filepath.Join(configDir, "agent.log")
	logErr := filepath.Join(configDir, "agent.err")
	return os.WriteFile(plistPath, []byte(launchdPlistXML(id.LaunchdLabel, args, logOut, logErr)), 0o644)
}

func launchdPlistXML(label string, args []string, logOut, logErr string) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>`)
	b.WriteString(xmlEscape(label))
	b.WriteString(`</string>
  <key>ProgramArguments</key>
  <array>
`)
	for _, arg := range args {
		b.WriteString("    <string>")
		b.WriteString(xmlEscape(arg))
		b.WriteString("</string>\n")
	}
	b.WriteString(`  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>`)
	b.WriteString(xmlEscape(logOut))
	b.WriteString(`</string>
  <key>StandardErrorPath</key>
  <string>`)
	b.WriteString(xmlEscape(logErr))
	b.WriteString(`</string>
</dict>
</plist>
`)
	return b.String()
}

func xmlEscape(s string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

func enclosingAppBundle(path string) string {
	p := resolved(path)
	for p != "." && p != string(filepath.Separator) {
		if strings.HasSuffix(p, ".app") {
			return p
		}
		next := filepath.Dir(p)
		if next == p {
			break
		}
		p = next
	}
	return ""
}

func swapAppBundle(staged, dest, previous string) error {
	_ = os.RemoveAll(previous)
	if _, err := os.Stat(dest); err == nil {
		if err := os.Rename(dest, previous); err != nil {
			return fmt.Errorf("move existing app aside: %w", err)
		}
	}
	if err := os.Rename(staged, dest); err != nil {
		if _, perr := os.Stat(previous); perr == nil {
			_ = os.Rename(previous, dest)
		}
		return fmt.Errorf("install app bundle: %w", err)
	}
	return nil
}

func linkCLI(symlink, target string) error {
	if err := os.MkdirAll(filepath.Dir(symlink), 0o755); err != nil {
		return err
	}
	_ = os.Remove(symlink)
	return os.Symlink(target, symlink)
}

func restartLaunchAgent(userHome, plistPath string) error {
	uid := os.Getuid()
	domain := fmt.Sprintf("gui/%d", uid)
	if err := exec.Command("launchctl", "bootout", domain, plistPath).Run(); err != nil {
		_ = exec.Command("launchctl", "unload", plistPath).Run()
	}
	if err := exec.Command("launchctl", "bootstrap", domain, plistPath).Run(); err != nil {
		_ = exec.Command("launchctl", "unload", plistPath).Run()
		if err := exec.Command("launchctl", "load", plistPath).Run(); err != nil {
			return fmt.Errorf("launchctl bootstrap/load failed: %w", err)
		}
	}
	id := config.CurrentServiceIdentity()
	label := domain + "/" + id.LaunchdLabel
	_ = exec.Command("launchctl", "kickstart", "-k", label).Run()
	return nil
}

func copyDir(src, dst string) error {
	info, err := os.Lstat(src)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		target, err := os.Readlink(src)
		if err != nil {
			return err
		}
		return os.Symlink(target, dst)
	}
	if !info.IsDir() {
		return copyFile(src, dst, info.Mode())
	}
	if err := os.MkdirAll(dst, info.Mode().Perm()); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err := copyDir(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
			return err
		}
	}
	return nil
}

func copyFile(src, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode.Perm())
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}

func resolved(path string) string {
	if path == "" {
		return ""
	}
	if r, err := filepath.EvalSymlinks(path); err == nil {
		return filepath.Clean(r)
	}
	return filepath.Clean(path)
}

func samePath(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	return resolved(a) == resolved(b)
}
