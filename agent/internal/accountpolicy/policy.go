package accountpolicy

import "strings"

const (
	ToolCursor    = "cursor"
	ToolCodex     = "codex"
	StreamUsage   = "usage"
	StreamLogging = "logging"
)

type Account struct {
	ToolName           string `json:"toolName"`
	AccountKey         string `json:"accountKey"`
	Email              string `json:"email,omitempty"`
	Plan               string `json:"plan,omitempty"`
	AuthPresent        bool   `json:"authPresent"`
	UsageEnabled       bool   `json:"usageEnabled"`
	LoggingEnabled     bool   `json:"loggingEnabled"`
	UsageAdminLocked   bool   `json:"usageAdminLocked"`
	LoggingAdminLocked bool   `json:"loggingAdminLocked"`
	UsageAllowed       bool   `json:"usageAllowed"`
	LoggingAllowed     bool   `json:"loggingAllowed"`
}

type Policy struct {
	Accounts []Account `json:"accounts"`
}

func Gated(toolName string) bool {
	return strings.TrimSpace(toolName) != ""
}

func NormalizeKey(accountKey, email string) string {
	key := strings.TrimSpace(accountKey)
	if key != "" {
		return key
	}
	return strings.ToLower(strings.TrimSpace(email))
}

func Match(accounts []Account, toolName, accountKey, email string) *Account {
	tool := strings.ToLower(strings.TrimSpace(toolName))
	key := NormalizeKey(accountKey, email)
	emailNorm := strings.ToLower(strings.TrimSpace(email))
	var emailMatch *Account
	for i := range accounts {
		row := &accounts[i]
		if strings.ToLower(strings.TrimSpace(row.ToolName)) != tool {
			continue
		}
		if NormalizeKey(row.AccountKey, row.Email) == key && key != "" {
			return row
		}
		if emailNorm != "" && strings.ToLower(strings.TrimSpace(row.Email)) == emailNorm {
			emailMatch = row
		}
	}
	return emailMatch
}

func UsageAllowed(policy *Policy, toolName, accountKey, email string) bool {
	if !Gated(toolName) {
		return true
	}
	if policy == nil {
		return false
	}
	account := Match(policy.Accounts, toolName, accountKey, email)
	if account == nil {
		return false
	}
	if account.UsageAllowed {
		return true
	}
	return account.UsageEnabled && !account.UsageAdminLocked
}

func LoggingAllowed(policy *Policy, toolName, accountKey, email string) bool {
	if !Gated(toolName) {
		return true
	}
	if policy == nil {
		return false
	}
	account := Match(policy.Accounts, toolName, accountKey, email)
	if account == nil {
		return false
	}
	if account.LoggingAllowed {
		return true
	}
	return account.LoggingEnabled && !account.LoggingAdminLocked
}
