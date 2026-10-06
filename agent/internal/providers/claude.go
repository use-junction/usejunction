package providers

import (
	"context"
	"os"
	"path/filepath"

	"github.com/usejunction/agent/internal/probe"
	"github.com/usejunction/agent/internal/scan"
	"github.com/usejunction/agent/internal/types"
)

type ClaudeProvider struct{}

func (p *ClaudeProvider) ID() string { return "claude" }

func claudeConfigDir() string {
	if d := os.Getenv("CLAUDE_CONFIG_DIR"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	candidate := filepath.Join(home, ".claude")
	if dirExists(candidate) {
		return candidate
	}
	return filepath.Join(home, ".config", "claude")
}

func (p *ClaudeProvider) Detect(ctx context.Context) (*types.ToolStatus, error) {
	dir := claudeConfigDir()
	creds := filepath.Join(dir, ".credentials.json")
	detected := fileExists(creds) || dirExists(dir)
	configured := false
	if account, err := probe.ClaudeAccountIdentity(dir); err == nil && account != nil && account.AuthPresent {
		detected = true
		configured = true
	}
	return &types.ToolStatus{
		ToolName:   p.ID(),
		Detected:   detected,
		Configured: configured,
		ConfigPath: dir,
	}, nil
}

func (p *ClaudeProvider) AccountIdentity(ctx context.Context) (*types.ToolAccount, error) {
	dir := claudeConfigDir()
	account, err := probe.ClaudeAccountIdentity(dir)
	if err != nil {
		return &types.ToolAccount{ToolName: p.ID(), LoginMethod: "unknown"}, nil
	}
	return account, nil
}

func (p *ClaudeProvider) ProbeQuota(ctx context.Context) ([]types.QuotaSnapshot, error) {
	quotas, _, err := probe.ProbeClaudeQuota(ctx, claudeConfigDir())
	return quotas, err
}

func (p *ClaudeProvider) OtherAccounts(ctx context.Context) []types.ToolAccount {
	return probe.ClaudeOtherAccounts()
}

func (p *ClaudeProvider) ScanLocalUsage(ctx context.Context, refresh bool) ([]types.DailyUsage, error) {
	// Desktop-launched sessions name their login; everything else falls back
	// to the active one.
	scan.SetSessionAccounts(p.ID(), probe.ClaudeSessionAccountKeys())
	home, _ := os.UserHomeDir()
	roots := []string{
		filepath.Join(claudeConfigDir(), "projects"),
		filepath.Join(home, ".claude", "projects"),
		filepath.Join(home, ".config", "claude", "projects"),
	}
	return scan.ScanClaude(roots, refresh)
}
