package providers

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/usejunction/agent/internal/platformdirs"
	"github.com/usejunction/agent/internal/probe"
	"github.com/usejunction/agent/internal/scan"
	"github.com/usejunction/agent/internal/types"
)

type CursorProvider struct{}

func (p *CursorProvider) ID() string { return "cursor" }

func (p *CursorProvider) Detect(ctx context.Context) (*types.ToolStatus, error) {
	home, _ := os.UserHomeDir()
	candidates := []string{
		platformdirs.CursorUserDir(),
		filepath.Join(home, ".cursor"),
	}
	detected := false
	configPath := ""
	for _, candidate := range candidates {
		if dirExists(candidate) {
			detected = true
			configPath = candidate
			break
		}
	}
	if _, err := exec.LookPath("cursor"); err == nil {
		detected = true
	}
	configured := detected
	if detected {
		if account, err := probe.CursorAccountFromLocal(); err == nil && account != nil && account.AuthPresent {
			configured = true
		}
	}
	return &types.ToolStatus{ToolName: p.ID(), Detected: detected, Configured: configured, ConfigPath: configPath}, nil
}

func (p *CursorProvider) AccountIdentity(ctx context.Context) (*types.ToolAccount, error) {
	account, err := probe.CursorAccountIdentity(ctx)
	if err != nil {
		return &types.ToolAccount{ToolName: p.ID(), LoginMethod: "unknown"}, nil
	}
	return account, nil
}

func (p *CursorProvider) ProbeQuota(ctx context.Context) ([]types.QuotaSnapshot, error) {
	quotas, _, err := probe.ProbeCursorQuota(ctx)
	return quotas, err
}

func (p *CursorProvider) ScanLocalUsage(ctx context.Context, refresh bool) ([]types.DailyUsage, error) {
	local, _ := scan.ScanCursorLocal(refresh)
	if scan.IsLocalOnly(ctx) {
		// Cursor keeps billed usage on cursor.com. A local-only scan uses what
		// the background service already saved, and never asks for more.
		return scan.MergeCursorUsage(local, probe.CachedCursorUsageEvents()), nil
	}
	events, _ := probe.ScanCursorUsageEvents(ctx, refresh)
	merged := scan.MergeCursorUsage(local, events)
	if len(merged) > 0 {
		return merged, nil
	}
	// Last resort: plan percent synthetic row (no cost).
	return probe.ScanCursorUsage(ctx)
}
