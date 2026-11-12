package cmd

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/usejunction/agent/internal/providers"
	"github.com/usejunction/agent/internal/types"
	"github.com/usejunction/agent/internal/ui"
)

// What the installer shows before asking for an account: a headline number
// read from this machine's own logs. Nothing here is uploaded.

const (
	localSummaryDays = 30
	// The summary is a courtesy; it must never hold up sign-in.
	localSummaryTimeout = 45 * time.Second
	// Tools named on the breakdown line before the rest fold into "+N more".
	localSummaryMaxTools = 4
)

type localToolCost struct {
	Tool string
	Cost float64
}

type localUsageSummary struct {
	Days  int
	Total float64
	// Tools with a cost in the window, most expensive first.
	Tools []localToolCost
	// ToolsSeen counts tools with any usage in the window, priced or not.
	ToolsSeen int
	// AllEstimated is true when every dollar is an API list-price estimate
	// rather than a vendor-reported or actual amount.
	AllEstimated bool
}

var toolDisplayNames = map[string]string{
	"claude":      "Claude Code",
	"codex":       "Codex",
	"cursor":      "Cursor",
	"copilot":     "Copilot",
	"opencode":    "OpenCode",
	"antigravity": "Antigravity",
	"gemini":      "Gemini",
	"cline":       "Cline",
	"roo":         "Roo Code",
	"continue":    "Continue",
	"ollama":      "Ollama",
	"lmstudio":    "LM Studio",
}

func toolDisplayName(id string) string {
	id = strings.TrimSpace(id)
	if name, ok := toolDisplayNames[strings.ToLower(id)]; ok {
		return name
	}
	if id == "" {
		return "Unknown"
	}
	return strings.ToUpper(id[:1]) + id[1:]
}

// summarizeLocalUsage totals billing usage dated within the last `days` days
// (today included). Productivity-only rows carry no spend and are left out.
func summarizeLocalUsage(rows []types.DailyUsage, now time.Time, days int) localUsageSummary {
	today := now.Format("2006-01-02")
	from := now.AddDate(0, 0, -(days - 1)).Format("2006-01-02")

	costByTool := map[string]float64{}
	seen := map[string]bool{}
	summary := localUsageSummary{Days: days, AllEstimated: true}
	for _, row := range rows {
		if row.MetricKind == types.MetricKindProductivity {
			continue
		}
		if row.Date < from || row.Date > today {
			continue
		}
		tool := toolDisplayName(row.ToolName)
		seen[tool] = true
		if row.EstimatedCost <= 0 {
			continue
		}
		costByTool[tool] += row.EstimatedCost
		summary.Total += row.EstimatedCost
		if row.CostKind != "" && row.CostKind != types.CostKindEstimatedAPI {
			summary.AllEstimated = false
		}
	}
	summary.ToolsSeen = len(seen)
	for tool, cost := range costByTool {
		summary.Tools = append(summary.Tools, localToolCost{Tool: tool, Cost: cost})
	}
	sort.Slice(summary.Tools, func(i, j int) bool {
		if summary.Tools[i].Cost != summary.Tools[j].Cost {
			return summary.Tools[i].Cost > summary.Tools[j].Cost
		}
		return summary.Tools[i].Tool < summary.Tools[j].Tool
	})
	return summary
}

// formatUSD prints whole dollars with thousands separators from $100 up, and
// cents below that, where they still matter.
func formatUSD(amount float64) string {
	if amount < 100 {
		return fmt.Sprintf("$%.2f", amount)
	}
	whole := fmt.Sprintf("%.0f", amount)
	var b strings.Builder
	for i, digit := range whole {
		if i > 0 && (len(whole)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(digit)
	}
	return "$" + b.String()
}

// headline is the one number worth showing before sign-in.
func (s localUsageSummary) headline() string {
	if s.Total <= 0 {
		if s.ToolsSeen > 0 {
			return fmt.Sprintf("Usage found from %d %s in the last %d days, with no cost to estimate yet", s.ToolsSeen, plural(s.ToolsSeen, "tool", "tools"), s.Days)
		}
		return fmt.Sprintf("No AI coding usage found on this machine in the last %d days", s.Days)
	}
	return fmt.Sprintf("≈ %s of AI coding usage in the last %d days", formatUSD(s.Total), s.Days)
}

// breakdown names the tools behind the headline, or "" when there is one or none.
func (s localUsageSummary) breakdown() string {
	if len(s.Tools) == 0 {
		return ""
	}
	parts := make([]string, 0, localSummaryMaxTools+1)
	for i, tool := range s.Tools {
		if i == localSummaryMaxTools {
			parts = append(parts, fmt.Sprintf("+%d more", len(s.Tools)-localSummaryMaxTools))
			break
		}
		parts = append(parts, fmt.Sprintf("%s %s", tool.Tool, formatUSD(tool.Cost)))
	}
	return strings.Join(parts, " · ")
}

// method says how the number was measured, so nobody mistakes it for a bill.
func (s localUsageSummary) method() string {
	if s.Total <= 0 {
		return "Read from local logs. Nothing has left this machine."
	}
	if s.AllEstimated {
		return "Estimated at API list prices from local logs, not your bill. Nothing has left this machine."
	}
	return "From local logs; part is estimated at API list prices. Nothing has left this machine."
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

// scanLocalUsage reads every provider's local usage side by side. It returns
// ok=false when the scan outlives timeout; the readers are left to finish in
// the background and their results are dropped.
func scanLocalUsage(ctx context.Context, timeout time.Duration) (rows []types.DailyUsage, ok bool) {
	done := make(chan []types.DailyUsage, 1)
	go func() {
		var (
			mu  sync.Mutex
			wg  sync.WaitGroup
			all []types.DailyUsage
		)
		for _, p := range providers.All() {
			wg.Add(1)
			go func(prov providers.Provider) {
				defer wg.Done()
				usage, err := prov.ScanLocalUsage(ctx, false)
				if err != nil || len(usage) == 0 {
					return
				}
				mu.Lock()
				all = append(all, usage...)
				mu.Unlock()
			}(p)
		}
		wg.Wait()
		done <- all
	}()
	select {
	case rows := <-done:
		return rows, true
	case <-time.After(timeout):
		return nil, false
	case <-ctx.Done():
		return nil, false
	}
}

// showLocalUsageSummary prints the pre-sign-in number. It reports whether there
// was anything to show, and never fails: sign-in goes ahead either way.
func showLocalUsageSummary(ctx context.Context) *localUsageSummary {
	step := ui.StepStart("Reading local usage")
	rows, ok := scanLocalUsage(ctx, localSummaryTimeout)
	if !ok {
		step.Done("still reading; your numbers will be on the dashboard")
		return nil
	}
	summary := summarizeLocalUsage(rows, time.Now(), localSummaryDays)
	step.Done(fmt.Sprintf("%d %s", summary.ToolsSeen, plural(summary.ToolsSeen, "tool", "tools")))
	ui.Headline(summary.headline())
	if breakdown := summary.breakdown(); breakdown != "" && len(summary.Tools) > 1 {
		ui.QuietLine(breakdown)
	}
	ui.QuietLine(summary.method())
	return &summary
}
