package syncengine

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"

	"github.com/usejunction/agent/internal/client"
)

// AccountsContentHash fingerprints account inventory.
// Must stay byte-compatible with apps/admin/lib/sync/accounts-inventory.ts.
func AccountsContentHash(accounts []client.AccountReport) string {
	lines := make([]string, 0, len(accounts))
	for _, a := range accounts {
		name := strings.TrimSpace(a.ToolName)
		if name == "" {
			continue
		}
		auth := "0"
		if a.AuthPresent {
			auth = "1"
		}
		lines = append(lines, fmt.Sprintf(
			"%s|%s|%s|%s|%s|%s|%s",
			name,
			strings.TrimSpace(a.AccountKey),
			strings.TrimSpace(a.Email),
			strings.TrimSpace(a.Plan),
			strings.TrimSpace(a.OrgKey),
			strings.TrimSpace(a.LoginMethod),
			auth,
		))
	}
	sort.Strings(lines)
	sum := sha256.Sum256([]byte(strings.Join(lines, "\n")))
	return hex.EncodeToString(sum[:])[:32]
}
