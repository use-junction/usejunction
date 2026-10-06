package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	DefaultHomeDirName       = ".usejunction"
	TestHomeDirName          = ".usejunction-test"
	DefaultLocalSyncPortTest = 47833

	profileEnv = "USEJUNCTION_PROFILE"
	homeEnv    = "USEJUNCTION_HOME"
)

// AgentServiceIdentity names the background service for an agent install profile.
type AgentServiceIdentity struct {
	LaunchdLabel    string
	LaunchdPlist    string
	SystemdUnit     string
	WindowsTaskName string
	AppName         string
	CLIName         string
}

var configuredHome string

// ApplyRuntimeProfile resolves the agent data directory from CLI flags, env, and
// the executable name. Call from the root command before any config load.
func ApplyRuntimeProfile(homeFlag, profileFlag string) error {
	if homeFlag != "" {
		return setConfiguredHome(homeFlag)
	}
	if h := strings.TrimSpace(os.Getenv(homeEnv)); h != "" {
		return setConfiguredHome(h)
	}

	profile := profileFlag
	if profile == "" {
		profile = strings.TrimSpace(os.Getenv(profileEnv))
	}
	switch profile {
	case "", "default":
		if isTestExecutable() {
			return setConfiguredHome(defaultTestHome())
		}
		return nil
	case "test":
		return setConfiguredHome(defaultTestHome())
	default:
		return fmt.Errorf("unknown agent profile %q (expected default or test)", profile)
	}
}

func setConfiguredHome(home string) error {
	home = strings.TrimSpace(home)
	if home == "" {
		return fmt.Errorf("agent home directory must not be empty")
	}
	if !filepath.IsAbs(home) {
		userHome, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		home = filepath.Join(userHome, home)
	}
	configuredHome = filepath.Clean(home)
	_ = os.Setenv(homeEnv, configuredHome)
	return nil
}

func defaultTestHome() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, TestHomeDirName)
}

func isTestExecutable() bool {
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	base := strings.ToLower(filepath.Base(exe))
	return strings.Contains(base, "usejunction-test")
}

// IsTestProfile reports whether the resolved agent home is the test profile.
func IsTestProfile() bool {
	return IsTestHomeDir(ConfigDir())
}

// IsTestHomeDir reports whether dir is a test-profile home directory.
func IsTestHomeDir(dir string) bool {
	return strings.HasSuffix(filepath.Clean(dir), TestHomeDirName)
}

// DefaultLocalSyncPortForProfile returns the default loopback sync port for the
// active profile.
func DefaultLocalSyncPortForProfile() int {
	if IsTestProfile() {
		return DefaultLocalSyncPortTest
	}
	return DefaultLocalSyncPort
}

// CurrentServiceIdentity returns launch/service names for the active profile.
func CurrentServiceIdentity() AgentServiceIdentity {
	return identityForHome(ConfigDir())
}

func identityForHome(homeDir string) AgentServiceIdentity {
	if IsTestHomeDir(homeDir) {
		return AgentServiceIdentity{
			LaunchdLabel:    "com.usejunction.agent.test",
			LaunchdPlist:    "com.usejunction.agent.test.plist",
			SystemdUnit:     "usejunction-agent-test.service",
			WindowsTaskName: "UseJunction Agent Test",
			AppName:         "UseJunctionTest",
			CLIName:         "usejunction-test",
		}
	}
	return AgentServiceIdentity{
		LaunchdLabel:    "com.usejunction.agent",
		LaunchdPlist:    "com.usejunction.agent.plist",
		SystemdUnit:     "usejunction-agent.service",
		WindowsTaskName: "UseJunction Agent",
		AppName:         "UseJunction",
		CLIName:         "usejunction",
	}
}

// LaunchdPlistPath returns the full path to the launchd plist for home.
func (s AgentServiceIdentity) LaunchdPlistPath(home string) string {
	return filepath.Join(home, "Library", "LaunchAgents", s.LaunchdPlist)
}

// AppBundlePath returns the visible macOS app bundle (not under the hidden
// config dir). USEJUNCTION_HOME only relocates data, not the .app.
func (s AgentServiceIdentity) AppBundlePath() string {
	return filepath.Join(userApplicationsDir(), s.AppName+".app")
}

// DaemonBinaryPath returns the macOS daemon executable inside the app bundle.
func (s AgentServiceIdentity) DaemonBinaryPath() string {
	return filepath.Join(s.AppBundlePath(), "Contents", "MacOS", "usejunction")
}

// PreviousAppBundlePath returns the rollback app bundle path beside the visible app.
func (s AgentServiceIdentity) PreviousAppBundlePath() string {
	return filepath.Join(userApplicationsDir(), s.AppName+".previous.app")
}

// LegacyAppBundlePath returns the pre-unhide bundle location under the data home.
func (s AgentServiceIdentity) LegacyAppBundlePath(configDir string) string {
	return filepath.Join(configDir, s.AppName+".app")
}

// CLISymlinkPath returns the PATH shim under the data home.
func (s AgentServiceIdentity) CLISymlinkPath(configDir string) string {
	return filepath.Join(configDir, "bin", s.CLIName)
}

func userApplicationsDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "Applications"
	}
	return filepath.Join(home, "Applications")
}
