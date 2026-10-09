package probe

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
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
	T   int64  `json:"t"`
	Org string `json:"org"`
	U   struct {
		FiveHour *int `json:"fh"`
		SevenDay *int `json:"sd"`
	} `json:"u"`
}

type claudeDesktopUsageHistory struct {
	Samples []claudeDesktopUsageSample `json:"samples"`
}

// ClaudeDesktopUsageSnapshots returns live quota windows for a single
// organization from the Claude desktop app's locally cached usage history, or
// nil when the file is missing, unreadable, or stale. The history interleaves
// samples from every org the app has seen, so org scopes the reading to the
// account being probed; an empty org falls back to the newest sample across all
// orgs (used when the active org is unknown).
func ClaudeDesktopUsageSnapshots(org string) []types.QuotaSnapshot {
	data, err := os.ReadFile(filepath.Join(claudeDesktopDir(), claudeDesktopUsageFile))
	if err != nil {
		return nil
	}
	return parseClaudeDesktopUsage(data, time.Now(), org)
}

func parseClaudeDesktopUsage(data []byte, now time.Time, org string) []types.QuotaSnapshot {
	var history claudeDesktopUsageHistory
	if json.Unmarshal(data, &history) != nil {
		return nil
	}

	org = strings.TrimSpace(org)
	var newest *claudeDesktopUsageSample
	for i := range history.Samples {
		s := &history.Samples[i]
		if s.T <= 0 {
			continue
		}
		if org != "" && strings.TrimSpace(s.Org) != org {
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
	return claudeDesktopSampleSnapshots(newest)
}

func claudeDesktopSampleSnapshots(sample *claudeDesktopUsageSample) []types.QuotaSnapshot {
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
	appendWindow("session_5h", sample.U.FiveHour)
	appendWindow("weekly", sample.U.SevenDay)
	return snapshots
}

// ClaudeDesktopUsageByOrg returns the newest fresh usage windows for every org
// present in the desktop history, keyed by org uuid. It lets us attribute live
// limits to each desktop login, not just the active one.
func ClaudeDesktopUsageByOrg() map[string][]types.QuotaSnapshot {
	data, err := os.ReadFile(filepath.Join(claudeDesktopDir(), claudeDesktopUsageFile))
	if err != nil {
		return nil
	}
	return parseClaudeDesktopUsageByOrg(data, time.Now())
}

func parseClaudeDesktopUsageByOrg(data []byte, now time.Time) map[string][]types.QuotaSnapshot {
	var history claudeDesktopUsageHistory
	if json.Unmarshal(data, &history) != nil {
		return nil
	}
	newestByOrg := map[string]*claudeDesktopUsageSample{}
	for i := range history.Samples {
		s := &history.Samples[i]
		org := strings.TrimSpace(s.Org)
		if s.T <= 0 || org == "" {
			continue
		}
		if cur, ok := newestByOrg[org]; !ok || s.T > cur.T {
			newestByOrg[org] = s
		}
	}
	out := map[string][]types.QuotaSnapshot{}
	for org, sample := range newestByOrg {
		if now.Sub(time.UnixMilli(sample.T)) > claudeDesktopUsageMaxAge {
			continue
		}
		if snaps := claudeDesktopSampleSnapshots(sample); len(snaps) > 0 {
			out[org] = snaps
		}
	}
	return out
}
