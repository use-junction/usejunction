package scan

import (
	"path/filepath"
	"strings"
	"sync"

	"github.com/usejunction/agent/internal/types"
)

var signedInAccounts sync.Map // toolName -> accountKey

// SetSignedInAccount records which login is active for a provider scan so
// file/sqlite attribution can stamp rows without changing every Scan signature.
func SetSignedInAccount(toolName, accountKey string) {
	toolName = strings.ToLower(strings.TrimSpace(toolName))
	accountKey = strings.TrimSpace(accountKey)
	if toolName == "" {
		return
	}
	if accountKey == "" {
		signedInAccounts.Delete(toolName)
		return
	}
	signedInAccounts.Store(toolName, accountKey)
}

// SignedInAccount returns the login currently being scanned for toolName.
func SignedInAccount(toolName string) string {
	v, ok := signedInAccounts.Load(strings.ToLower(strings.TrimSpace(toolName)))
	if !ok {
		return ""
	}
	s, _ := v.(string)
	return strings.TrimSpace(s)
}

// AccountFromRecord reads a stable account id from a session/event object.
func AccountFromRecord(row map[string]any) string {
	if len(row) == 0 {
		return ""
	}
	payload, _ := row["payload"].(map[string]any)
	user, _ := row["user"].(map[string]any)
	account, _ := row["account"].(map[string]any)
	auth, _ := row["auth"].(map[string]any)
	objects := []map[string]any{row, payload, user, account, auth}
	idKeys := []string{"account_id", "accountId", "user_id", "userId", "account_uuid", "accountUuid"}
	emailKeys := []string{"account_email", "accountEmail", "email"}
	for _, obj := range objects {
		if obj == nil {
			continue
		}
		for _, key := range idKeys {
			if v := strings.TrimSpace(asString(obj[key])); v != "" {
				return v
			}
		}
	}
	for _, obj := range objects {
		if obj == nil {
			continue
		}
		for _, key := range emailKeys {
			if v := strings.ToLower(strings.TrimSpace(asString(obj[key]))); v != "" {
				return v
			}
		}
	}
	return ""
}

func asString(v any) string {
	s, _ := v.(string)
	return s
}

func (s *ScanSnapshot) cloneAccountFiles() map[string]string {
	out := map[string]string{}
	for path, key := range s.AccountFiles {
		if strings.TrimSpace(path) == "" {
			continue
		}
		out[path] = strings.TrimSpace(key)
	}
	return out
}

func (s *ScanSnapshot) mergeAccountFiles(files map[string]string) {
	if len(files) == 0 {
		return
	}
	if s.AccountFiles == nil {
		s.AccountFiles = map[string]string{}
	}
	for path, key := range files {
		path = strings.TrimSpace(path)
		key = strings.TrimSpace(key)
		if path == "" || key == "" {
			continue
		}
		s.AccountFiles[path] = key
	}
}

// RememberFile keeps the first account observed for path. explicit wins over fallback.
func RememberFile(files map[string]string, path, explicit, fallback string) string {
	path = strings.TrimSpace(path)
	explicit = strings.TrimSpace(explicit)
	fallback = strings.TrimSpace(fallback)
	if path == "" {
		if explicit != "" {
			return explicit
		}
		return fallback
	}
	if files == nil {
		if explicit != "" {
			return explicit
		}
		return fallback
	}
	if explicit != "" {
		files[path] = explicit
		return explicit
	}
	if existing := strings.TrimSpace(files[path]); existing != "" {
		return existing
	}
	if fallback != "" {
		files[path] = fallback
		return fallback
	}
	return ""
}

// FileAccount returns the first-seen account for path, persisting it on the scan snapshot.
func FileAccount(path, explicit, fallback string) string {
	var out string
	_ = CommitScanSnapshotUpdate(func(snap *ScanSnapshot) {
		if snap.AccountFiles == nil {
			snap.AccountFiles = map[string]string{}
		}
		out = RememberFile(snap.AccountFiles, path, explicit, fallback)
	})
	return out
}

func activityGrain(row types.DailyUsage) string {
	source := row.Source
	if source == "" {
		source = "local_scan"
	}
	return strings.Join([]string{row.ToolName, row.Date, row.Model, source}, "|")
}

func activityChanged(prev, next types.DailyUsage) bool {
	return prev.InputTokens != next.InputTokens ||
		prev.OutputTokens != next.OutputTokens ||
		prev.CacheReadTokens != next.CacheReadTokens ||
		prev.CacheWriteTokens != next.CacheWriteTokens ||
		prev.ReasoningTokens != next.ReasoningTokens ||
		prev.Requests != next.Requests ||
		prev.SuggestedLines != next.SuggestedLines ||
		prev.AcceptedLines != next.AcceptedLines ||
		prev.AddedLines != next.AddedLines ||
		prev.DeletedLines != next.DeletedLines ||
		prev.Commits != next.Commits ||
		prev.EstimatedCost != next.EstimatedCost
}

// StampObservedActivity attributes sqlite-style absolute totals to the login
// that was signed in when the totals changed. First-seen history stays unscoped.
func StampObservedActivity(prev, current []types.DailyUsage, signedIn string) []types.DailyUsage {
	signedIn = strings.TrimSpace(signedIn)
	prevBy := make(map[string]types.DailyUsage, len(prev))
	for _, row := range prev {
		prevBy[activityGrain(row)] = row
	}
	out := make([]types.DailyUsage, 0, len(current))
	for _, row := range current {
		if strings.TrimSpace(row.AccountKey) != "" {
			out = append(out, row)
			continue
		}
		earlier, ok := prevBy[activityGrain(row)]
		if !ok {
			out = append(out, row)
			continue
		}
		if !activityChanged(earlier, row) {
			row.AccountKey = strings.TrimSpace(earlier.AccountKey)
			out = append(out, row)
			continue
		}
		row.AccountKey = signedIn
		out = append(out, row)
	}
	return out
}

func stampSourceActivity(toolName, source string, rows []types.DailyUsage) []types.DailyUsage {
	snap, _ := LoadScanSnapshot()
	return StampObservedActivity(AggregatesForSource(snap, toolName, source), rows, SignedInAccount(toolName))
}

var sessionAccounts sync.Map // toolName -> map[sessionID]accountKey

// SetSessionAccounts records which login ran each session for a provider whose
// logs carry no account (e.g. Claude Code launched from the desktop app).
func SetSessionAccounts(toolName string, bySession map[string]string) {
	toolName = strings.ToLower(strings.TrimSpace(toolName))
	if toolName == "" {
		return
	}
	if len(bySession) == 0 {
		sessionAccounts.Delete(toolName)
		return
	}
	sessionAccounts.Store(toolName, bySession)
}

// SessionAccountHint returns the login that ran the session a log file belongs
// to. Subagent logs live under <session>/subagents/, so parent dirs count too.
func SessionAccountHint(toolName, path string) string {
	v, ok := sessionAccounts.Load(strings.ToLower(strings.TrimSpace(toolName)))
	if !ok {
		return ""
	}
	bySession, _ := v.(map[string]string)
	dir, file := filepath.Split(path)
	if key := bySession[strings.TrimSuffix(file, filepath.Ext(file))]; key != "" {
		return key
	}
	for dir = filepath.Clean(dir); dir != "." && dir != string(filepath.Separator); dir = filepath.Dir(dir) {
		if key := bySession[filepath.Base(dir)]; key != "" {
			return key
		}
	}
	return ""
}

// sessionHintsChanged reports whether any file's session hint disagrees with
// the account it was saved under, so cached aggregates must be rebuilt.
func sessionHintsChanged(toolName string, saved map[string]string, current map[string]SourceWatermark) bool {
	for _, wm := range current {
		if hint := SessionAccountHint(toolName, wm.Path); hint != "" && strings.TrimSpace(saved[wm.Path]) != hint {
			return true
		}
	}
	return false
}
