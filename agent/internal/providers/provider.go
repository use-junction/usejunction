// Package providers implements detect/observe logic for each AI coding tool.
package providers

import (
	"context"

	"github.com/usejunction/agent/internal/types"
)

// Provider is the interface every tool adapter must implement.
type Provider interface {
	// ID returns the stable identifier used in config, flags, and API payloads.
	ID() string
	// Detect checks whether the tool is installed and whether local auth or
	// config is present for observability.
	Detect(ctx context.Context) (*types.ToolStatus, error)
	// AccountIdentity returns any authenticated identity available locally
	// (e.g. from a credentials file). Implementations that cannot determine
	// identity return a placeholder with AuthPresent=false.
	AccountIdentity(ctx context.Context) (*types.ToolAccount, error)
	// ProbeQuota attempts to retrieve current quota/credit information without
	// making network calls that require browser auth. Returns nil when not
	// available.
	ProbeQuota(ctx context.Context) ([]types.QuotaSnapshot, error)
	// ScanLocalUsage reads local tool storage (JSONL sessions, sqlite DBs,
	// extension task JSON) to aggregate token counts and estimated cost.
	// refresh=true bypasses the on-disk scan cache; upload filtering is separate.
	ScanLocalUsage(ctx context.Context, refresh bool) ([]types.DailyUsage, error)
}

// All returns all known providers in a stable order.
func All() []Provider {
	return []Provider{
		&CodexProvider{},
		&ClaudeProvider{},
		&CursorProvider{},
		&AntigravityProvider{},
		&CopilotProvider{},
		&ContinueProvider{},
		&ClineProvider{Tool: "cline"},
		&ClineProvider{Tool: "roo"},
		&OpenCodeProvider{},
		&OllamaProvider{},
		&LMStudioProvider{},
	}
}

// MultiAccountProvider is implemented by providers that can see logins other
// than the active one on this device (each gets its own collection switch).
type MultiAccountProvider interface {
	OtherAccounts(ctx context.Context) []types.ToolAccount
}
