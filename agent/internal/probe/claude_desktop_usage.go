package probe

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"github.com/usejunction/agent/internal/types"
)

// Most people drive Claude from the desktop app, not the Claude Code CLI, so a
// machine can have a detected plan but no Code OAuth token to read live usage
// windows from. The desktop app already polls /api/oauth/usage while it runs
// and writes the resulting five-hour and seven-day utilization to
// plan-usage-history.json in plaintext. We read that file so those machines
// still report live quota pressure — never the desktop app's token cache.

const (
	claudeDesktopUsageFile   = "plan-usage-history.json"
	claudeDesktopUsageSource = "desktop_history"

	// claudeDesktopUsageMaxAge bounds how stale the newest sample may be and
	// still count as "live". The five-hour window is the shortest we report, so
	// anything much older risks showing a window that has already reset. Six
	// hours keeps a reading from someone who used the app earlier today while
	// skipping machines where the app has not run in a while (those fall back to
	// the existing "sign in with Claude Code" hint, no worse than before).
	claudeDesktopUsageMaxAge = 6 * time.Hour
)

type claudeDesktopUsageSample struct {
	T int64 `json:"t"`
	U struct {
		FiveHour *int `json:"fh"`
		SevenDay *int `json:"sd"`
	} `json:"u"`
}

type claudeDesktopUsageHistory struct {
	Samples []claudeDesktopUsageSample `json:"samples"`
}

// ClaudeDesktopUsageSnapshots returns live quota windows from the Claude
// desktop app's locally cached usage history, or nil when the file is missing,
// unreadable, or stale.
func ClaudeDesktopUsageSnapshots() []types.QuotaSnapshot {
	data, err := os.ReadFile(filepath.Join(claudeDesktopDir(), claudeDesktopUsageFile))
	if err != nil {
		return nil
	}
	return parseClaudeDesktopUsage(data, time.Now())
}

func parseClaudeDesktopUsage(data []byte, now time.Time) []types.QuotaSnapshot {
	var history claudeDesktopUsageHistory
	if json.Unmarshal(data, &history) != nil {
		return nil
	}

	var newest *claudeDesktopUsageSample
	for i := range history.Samples {
		s := &history.Samples[i]
		if s.T <= 0 {
			continue
		}
		if newest == nil || s.T > newest.T {
			newest = s
		}
	}
	if newest == nil {
		return nil
	}
	if now.Sub(time.UnixMilli(newest.T)) > claudeDesktopUsageMaxAge {
		return nil
	}

	var snapshots []types.QuotaSnapshot
	appendWindow := func(windowType string, used *int) {
		if used == nil {
			return
		}
		snapshots = append(snapshots, types.QuotaSnapshot{
			ToolName:    "claude",
			WindowType:  windowType,
			UsedPercent: floatPtr(float64(*used)),
			Source:      claudeDesktopUsageSource,
		})
	}
	appendWindow("session_5h", newest.U.FiveHour)
	appendWindow("weekly", newest.U.SevenDay)

	return snapshots
}
