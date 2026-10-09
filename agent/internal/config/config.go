package config

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Version is replaced by release builds through -ldflags. The fallback keeps
// local source builds and the first updater bootstrap identifiable.
var Version = "0.3.5"

// LocalSyncProtocol identifies the background-job localhost sync contract.
const LocalSyncProtocol = 2

// RemoteSyncProtocol identifies the durable control-plane sync request contract.
const RemoteSyncProtocol = 1

// Config holds the persisted enrollment state.
type Config struct {
	ControlPlaneURL string `json:"controlPlaneUrl"`
	DeviceToken     string `json:"deviceToken"`
	DeviceID        string `json:"deviceId"`
	UserID          string `json:"userId"`
	OrgID           string `json:"orgId"`
	// GatewayURL is legacy. Observability-only agents must leave vendor tool
	// configs alone and must not route traffic through a gateway.
	GatewayURL              string `json:"gatewayUrl,omitempty"`
	OtelEnabled             bool   `json:"otelEnabled,omitempty"`
	OtelMetricsEndpoint     string `json:"otelMetricsEndpoint,omitempty"`
	LocalSyncPort           int    `json:"localSyncPort,omitempty"`
	LocalSyncToken          string `json:"localSyncToken,omitempty"`
	SignalsEnabled          bool   `json:"signalsEnabled,omitempty"`
	SignalsWorkExtraction   bool   `json:"signalsWorkExtraction,omitempty"`
	SignalsPolicyUpdatedAt  string `json:"signalsPolicyUpdatedAt,omitempty"`
	SignalsLastUploadAt     string `json:"signalsLastUploadAt,omitempty"`
	WorkExtractionStartedAt string `json:"workExtractionStartedAt,omitempty"`
	WorkExtractionLastAt    string `json:"workExtractionLastAt,omitempty"`
	CollectionNoticeVersion string `json:"collectionNoticeVersion,omitempty"`
	BlockedUpdateVersion    string `json:"blockedUpdateVersion,omitempty"`
	// LastFullUsageRescanDay is the UTC YYYY-MM-DD of the last control-plane
	// sealed full usage rescan this agent completed.
	LastFullUsageRescanDay string `json:"lastFullUsageRescanDay,omitempty"`
	// LastCollectCompletedAt is when the most recent collect finished (RFC3339Nano).
	// Used to skip the daemon's immediate post-onboard duplicate collect.
	LastCollectCompletedAt string `json:"lastCollectCompletedAt,omitempty"`
	// ClaudeDesktopUsageConsent records that the user explicitly opted in to let
	// the agent read the Claude desktop app's encrypted credential store (one
	// macOS Keychain "Always Allow" grant) to fetch live limits for the account
	// they are actively using but which the Claude Code CLI is not signed into.
	// Off by default; only a user-initiated `claude-desktop connect` sets it, and
	// the keychain is never touched while it is false.
	ClaudeDesktopUsageConsent bool `json:"claudeDesktopUsageConsent,omitempty"`
}

const DefaultLocalSyncPort = 47832

// LocalSyncURL returns the loopback metrics endpoint for this device.
func (c *Config) LocalSyncURL() string {
	port := c.LocalSyncPort
	if port <= 0 {
		port = DefaultLocalSyncPortForProfile()
	}
	return fmt.Sprintf("http://127.0.0.1:%d", port)
}

// EnsureLocalSyncCredentials creates a local sync token/port if missing.
func (c *Config) EnsureLocalSyncCredentials() (bool, error) {
	changed := false
	if c.LocalSyncPort <= 0 {
		c.LocalSyncPort = DefaultLocalSyncPortForProfile()
		changed = true
	}
	if strings.TrimSpace(c.LocalSyncToken) == "" {
		token, err := randomToken(24)
		if err != nil {
			return false, err
		}
		c.LocalSyncToken = token
		changed = true
	}
	return changed, nil
}

// ConfigDir returns the agent data directory (~/.usejunction by default).
func ConfigDir() string {
	if configuredHome != "" {
		return configuredHome
	}
	if h := strings.TrimSpace(os.Getenv(homeEnv)); h != "" {
		return filepath.Clean(h)
	}
	home, _ := os.UserHomeDir()
	if profile := strings.TrimSpace(os.Getenv(profileEnv)); profile == "test" {
		return filepath.Join(home, TestHomeDirName)
	}
	return filepath.Join(home, DefaultHomeDirName)
}

// ConfigPath returns ~/.usejunction/config.json.
func ConfigPath() string {
	return filepath.Join(ConfigDir(), "config.json")
}

// BackupDir returns ~/.usejunction/backups.
func BackupDir() string {
	return filepath.Join(ConfigDir(), "backups")
}

// CacheDir returns ~/.usejunction/cache/cost-usage — local scan caches and
// the shared scan-snapshot.json used for incremental tool scans.
func CacheDir() string {
	return filepath.Join(ConfigDir(), "cache", "cost-usage")
}

func UpdateStatePath() string {
	return filepath.Join(ConfigDir(), "update-state.json")
}

func UpdateHistoryPath() string {
	return filepath.Join(ConfigDir(), "update-history.json")
}

func UpdateHandoffResultPath() string {
	return filepath.Join(ConfigDir(), "update-handoff-result.json")
}

// Load reads and parses the config file. Returns an error when not enrolled.
func Load() (*Config, error) {
	data, err := os.ReadFile(ConfigPath())
	if err != nil {
		return nil, err
	}
	var c Config
	if err := json.Unmarshal(data, &c); err != nil {
		return nil, err
	}
	return &c, nil
}

// Save persists c to disk, creating directories as needed.
func Save(c *Config) error {
	if err := os.MkdirAll(ConfigDir(), 0700); err != nil {
		return err
	}
	// Never persist a gateway URL. Older agents used this to rewrite vendor
	// tool configs; observability-only agents must not.
	c.GatewayURL = ""
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(ConfigPath(), data, 0600)
}

func randomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "uj_local_" + base64.RawURLEncoding.EncodeToString(b), nil
}
