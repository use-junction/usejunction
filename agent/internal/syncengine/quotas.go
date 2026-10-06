package syncengine

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/usejunction/agent/internal/client"
)

// QuotasContentHash fingerprints quota inventory.
// Must stay byte-compatible with apps/admin/lib/sync/quotas-inventory.ts.
func QuotasContentHash(quotas []client.QuotaReport) string {
	lines := make([]string, 0, len(quotas))
	for _, q := range quotas {
		name := strings.TrimSpace(q.ToolName)
		window := strings.TrimSpace(q.WindowType)
		if name == "" || window == "" {
			continue
		}
		used := ""
		if q.UsedPercent != nil {
			used = strconv.FormatFloat(*q.UsedPercent, 'f', -1, 64)
		}
		reset := ""
		if q.ResetAt != nil {
			reset = strings.TrimSpace(*q.ResetAt)
		}
		credits := ""
		if q.CreditsRemaining != nil {
			credits = strconv.FormatFloat(*q.CreditsRemaining, 'f', -1, 64)
		}
		lines = append(lines, fmt.Sprintf(
			"%s|%s|%s|%s|%s|%s%s",
			name,
			window,
			used,
			reset,
			credits,
			strings.TrimSpace(q.Source),
			quotaAccountSuffix(q.AccountKey),
		))
	}
	sort.Strings(lines)
	sum := sha256.Sum256([]byte(strings.Join(lines, "\n")))
	return hex.EncodeToString(sum[:])[:32]
}

func quotaAccountSuffix(accountKey string) string {
	accountKey = strings.TrimSpace(accountKey)
	if accountKey == "" {
		return ""
	}
	return "|" + accountKey
}
