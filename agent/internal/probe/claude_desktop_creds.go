package probe

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/pbkdf2"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/usejunction/agent/internal/types"
)

// This reads the Claude desktop app's own encrypted credential store, and is
// used ONLY for the account the user is actively running when that login is not
// the one the Claude Code CLI is signed into — so Junction can show its live
// limits. It is strictly opt-in: nothing here runs unless the user ran
// `claude-desktop connect`, which records consent and triggers the single
// macOS Keychain "Always Allow" grant. The agent never reads this store in the
// background without that consent, and never writes to it.
//
// The store is an Electron safeStorage blob in config.json under
// "oauth:tokenCacheV2", encrypted with Chromium OSCrypt v10 (AES-128-CBC, key =
// PBKDF2 of the "Claude Safe Storage" Keychain secret).

const (
	claudeSafeStorageService = "Claude Safe Storage"

	oscryptSalt       = "saltysalt"
	oscryptIterations = 1003
	oscryptKeyLen     = 16
)

// claudeDesktopToken is one login found in the desktop credential store. The
// access token is used only in-memory to call the usage API; it is never
// persisted.
type claudeDesktopToken struct {
	AccountUUID      string
	OrgUUID          string
	Email            string
	Plan             string
	SubscriptionType string
	RateLimitTier    string
	AccessToken      string
	ExpiresAtMs      int64
}

func (t claudeDesktopToken) expired(now time.Time) bool {
	if t.ExpiresAtMs <= 0 {
		return false // unknown expiry: attempt the fetch, the API rejects a dead token
	}
	ms := t.ExpiresAtMs
	if ms < 1_000_000_000_000 { // looks like seconds, not milliseconds
		ms *= 1000
	}
	return now.UnixMilli() >= ms
}

// ClaudeDesktopTokens decrypts the desktop credential store and returns the
// logins it holds. macOS only; returns nil (never an error) on other platforms
// or when the store is absent/unreadable, so callers degrade gracefully.
func ClaudeDesktopTokens() []claudeDesktopToken {
	if runtime.GOOS != "darwin" {
		return nil
	}
	plaintext, err := decryptClaudeDesktopTokenCache(claudeDesktopDir())
	if err != nil {
		return nil
	}
	return parseClaudeDesktopTokens(plaintext)
}

func decryptClaudeDesktopTokenCache(desktopDir string) ([]byte, error) {
	blob, err := claudeDesktopTokenCacheCiphertext(desktopDir)
	if err != nil {
		return nil, err
	}
	secret, err := loadClaudeSafeStorageSecret()
	if err != nil {
		return nil, err
	}
	return oscryptDecrypt(blob, secret)
}

func claudeDesktopTokenCacheCiphertext(desktopDir string) ([]byte, error) {
	data, err := os.ReadFile(filepath.Join(desktopDir, "config.json"))
	if err != nil {
		return nil, err
	}
	var cfg map[string]json.RawMessage
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	for _, key := range []string{"oauth:tokenCacheV2", "oauth:tokenCache"} {
		raw, ok := cfg[key]
		if !ok {
			continue
		}
		var encoded string
		if json.Unmarshal(raw, &encoded) != nil || strings.TrimSpace(encoded) == "" {
			continue
		}
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			continue
		}
		return decoded, nil
	}
	return nil, fmt.Errorf("claude desktop token cache not present")
}

// loadClaudeSafeStorageSecret reads the app's OSCrypt secret from the Keychain.
// This is the one call that can surface the macOS authorization prompt; it runs
// only under explicit user consent.
func loadClaudeSafeStorageSecret() ([]byte, error) {
	out, err := exec.Command(
		"security", "find-generic-password", "-s", claudeSafeStorageService, "-w",
	).Output()
	if err != nil {
		return nil, err
	}
	secret := strings.TrimSpace(string(out))
	if secret == "" {
		return nil, fmt.Errorf("empty safe storage secret")
	}
	return []byte(secret), nil
}

func oscryptDecrypt(ciphertext, secret []byte) ([]byte, error) {
	if len(ciphertext) >= 3 && ciphertext[0] == 'v' && ciphertext[1] == '1' {
		ciphertext = ciphertext[3:]
	}
	if len(ciphertext) == 0 || len(ciphertext)%aes.BlockSize != 0 {
		return nil, fmt.Errorf("unexpected ciphertext length %d", len(ciphertext))
	}
	key, err := pbkdf2.Key(sha1.New, string(secret), []byte(oscryptSalt), oscryptIterations, oscryptKeyLen)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	iv := bytes.Repeat([]byte{' '}, aes.BlockSize)
	plaintext := make([]byte, len(ciphertext))
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(plaintext, ciphertext)
	return pkcs7Unpad(plaintext, aes.BlockSize)
}

func pkcs7Unpad(data []byte, blockSize int) ([]byte, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("empty plaintext")
	}
	pad := int(data[len(data)-1])
	if pad == 0 || pad > blockSize || pad > len(data) {
		return nil, fmt.Errorf("invalid padding")
	}
	for _, b := range data[len(data)-pad:] {
		if int(b) != pad {
			return nil, fmt.Errorf("invalid padding byte")
		}
	}
	return data[:len(data)-pad], nil
}

// parseClaudeDesktopTokens harvests login objects from the decrypted store. The
// container layout is not contractual, so it walks the whole tree and collects
// any object carrying an access token plus an account identity, merging by
// account uuid (which may appear only as a parent key).
func parseClaudeDesktopTokens(plaintext []byte) []claudeDesktopToken {
	var root any
	if json.Unmarshal(plaintext, &root) != nil {
		return nil
	}
	byUUID := map[string]*claudeDesktopToken{}
	harvestClaudeTokens(root, "", byUUID)
	var out []claudeDesktopToken
	for _, t := range byUUID {
		if t.AccessToken == "" {
			continue
		}
		// subscriptionType and rateLimitTier can arrive from separate nested
		// objects, so derive the display plan only after the merge is complete.
		t.Plan = claudePlanWithTier(t.SubscriptionType, t.RateLimitTier)
		out = append(out, *t)
	}
	return out
}

func harvestClaudeTokens(node any, keyHint string, byUUID map[string]*claudeDesktopToken) {
	switch v := node.(type) {
	case map[string]any:
		tok := claudeTokenFromObject(v)
		if tok.AccountUUID == "" && looksLikeUUID(keyHint) {
			tok.AccountUUID = keyHint
		}
		// Only record something that carries an account identity and at least
		// one useful field; identity and token may live in sibling objects
		// nested under the same account-uuid key, so they merge by uuid.
		if tok.AccountUUID != "" && claudeTokenHasFields(tok) {
			if existing, ok := byUUID[tok.AccountUUID]; ok {
				mergeClaudeToken(existing, tok)
			} else {
				byUUID[tok.AccountUUID] = tok
			}
		}
		for key, child := range v {
			childHint := key
			// Carry the account uuid down to nested objects that are not
			// themselves keyed by a uuid (e.g. "profile", "claudeAiOauth").
			if looksLikeUUID(keyHint) && !looksLikeUUID(key) {
				childHint = keyHint
			}
			harvestClaudeTokens(child, childHint, byUUID)
		}
	case []any:
		for _, child := range v {
			harvestClaudeTokens(child, "", byUUID)
		}
	}
}

func claudeTokenFromObject(obj map[string]any) *claudeDesktopToken {
	pick := func(keys ...string) string {
		for _, k := range keys {
			for objKey, val := range obj {
				if !strings.EqualFold(objKey, k) {
					continue
				}
				if s, ok := val.(string); ok && strings.TrimSpace(s) != "" {
					return strings.TrimSpace(s)
				}
			}
		}
		return ""
	}
	pickInt := func(keys ...string) int64 {
		for _, k := range keys {
			for objKey, val := range obj {
				if !strings.EqualFold(objKey, k) {
					continue
				}
				if f, ok := val.(float64); ok {
					return int64(f)
				}
			}
		}
		return 0
	}

	// Return whatever this object carries; identity and token can be split
	// across sibling objects, so callers merge partial results by account uuid.
	return &claudeDesktopToken{
		AccountUUID:      pick("accountUuid", "accountUUID", "account_uuid"),
		OrgUUID:          pick("organizationUuid", "orgUuid", "organization_uuid"),
		Email:            pick("emailAddress", "email"),
		SubscriptionType: pick("subscriptionType", "subscription_type"),
		RateLimitTier:    pick("rateLimitTier", "rate_limit_tiers", "organizationRateLimitTier"),
		AccessToken:      pick("accessToken", "access_token"),
		ExpiresAtMs:      pickInt("expiresAt", "expires_at_ms", "expiresAtMs"),
	}
}

// claudeTokenHasFields reports whether anything beyond a bare uuid was found,
// so empty container objects do not create phantom entries.
func claudeTokenHasFields(t *claudeDesktopToken) bool {
	return t.AccessToken != "" || t.Email != "" || t.OrgUUID != "" ||
		t.SubscriptionType != "" || t.RateLimitTier != "" || t.ExpiresAtMs != 0
}

func mergeClaudeToken(dst, src *claudeDesktopToken) {
	if dst.AccessToken == "" {
		dst.AccessToken = src.AccessToken
	}
	if dst.Email == "" {
		dst.Email = src.Email
	}
	if dst.OrgUUID == "" {
		dst.OrgUUID = src.OrgUUID
	}
	if dst.SubscriptionType == "" {
		dst.SubscriptionType = src.SubscriptionType
	}
	if dst.RateLimitTier == "" {
		dst.RateLimitTier = src.RateLimitTier
	}
	if dst.ExpiresAtMs == 0 {
		dst.ExpiresAtMs = src.ExpiresAtMs
	}
}

// ClaudeDesktopUsageDebug walks the active-account usage path and reports what
// happened at each step, for the `claude-desktop connect` command to print.
// It never includes token values.
func ClaudeDesktopUsageDebug(ctx context.Context) string {
	var b strings.Builder
	active := ClaudeActiveDesktopAccount()
	if active == nil {
		return "no active desktop session found"
	}
	fmt.Fprintf(&b, "active account uuid=%s org=%s lastActivity=%s\n",
		short(active.AccountUUID), short(active.OrgUUID), active.LastActivity.Format(time.RFC3339))
	tokens := ClaudeDesktopTokens()
	fmt.Fprintf(&b, "decrypted logins: %d\n", len(tokens))
	var token *claudeDesktopToken
	for _, t := range tokens {
		marker := ""
		if t.AccountUUID == active.AccountUUID {
			tok := t
			token = &tok
			marker = " <- active"
		}
		fmt.Fprintf(&b, "  login uuid=%s email=%q plan=%q hasToken=%v%s\n",
			short(t.AccountUUID), t.Email, t.Plan, t.AccessToken != "", marker)
	}
	if token == nil {
		fmt.Fprint(&b, "no token for the active account in the decrypted store\n")
		return b.String()
	}
	if token.expired(time.Now()) {
		fmt.Fprintf(&b, "active token is expired (expiresAt=%d)\n", token.ExpiresAtMs)
		return b.String()
	}
	raw, status, err := fetchClaudeUsage(ctx, token.AccessToken)
	fmt.Fprintf(&b, "usage API: status=%d err=%v\n", status, err)
	if err == nil && status < 300 {
		keys := make([]string, 0, len(raw))
		for k := range raw {
			keys = append(keys, k)
		}
		fmt.Fprintf(&b, "response keys: %v\n", keys)
		fmt.Fprintf(&b, "parsed windows: %d\n", len(claudeUsageSnapshots(raw)))
	}
	fmt.Fprintf(&b, "accountKey used: %s\n", ClaudeAccountKey(token.AccountUUID, token.Email))
	return b.String()
}

func short(s string) string {
	if len(s) > 8 {
		return s[:8]
	}
	return s
}

// ClaudeActiveDesktopUsage returns live quota windows for the account the user
// is actively running in the desktop app, fetched from the usage API with that
// account's own token. It is a no-op returning nil unless `consent` is true
// (the user ran `claude-desktop connect`). The returned account carries the
// resolved plan/tier; snapshots are tagged with the account key so the control
// plane files them under the right login.
func ClaudeActiveDesktopUsage(ctx context.Context, consent bool) ([]types.QuotaSnapshot, *types.ToolAccount) {
	if !consent {
		return nil, nil
	}
	active := ClaudeActiveDesktopAccount()
	if active == nil || strings.TrimSpace(active.AccountUUID) == "" {
		return nil, nil
	}
	// One decrypt yields every desktop login; record each one's email/plan so all
	// of them get a label (not just the active account we fetch usage for).
	tokens := ClaudeDesktopTokens()
	var token *claudeDesktopToken
	for _, t := range tokens {
		if t.Email != "" {
			rememberClaudeAccount(t.AccountUUID, t.Email, t.Plan)
		}
		if t.AccountUUID == active.AccountUUID {
			tok := t
			token = &tok
		}
	}
	if token == nil || token.expired(time.Now()) {
		return nil, nil
	}

	accountKey := ClaudeAccountKey(token.AccountUUID, token.Email)
	account := &types.ToolAccount{
		ToolName:    "claude",
		AccountKey:  accountKey,
		Email:       token.Email,
		Plan:        token.Plan,
		OrgKey:      token.OrgUUID,
		LoginMethod: "desktop",
		AuthPresent: true,
	}
	raw, status, err := fetchClaudeUsage(ctx, token.AccessToken)
	if err != nil || status >= 300 {
		return nil, account
	}
	if p := claudePlanFromUsageRaw(raw); p != "" {
		account.Plan = preferClaudePlan(account.Plan, p)
	}
	snaps := claudeUsageSnapshots(raw)
	for i := range snaps {
		snaps[i].AccountKey = accountKey
	}
	return snaps, account
}

func looksLikeUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, r := range s {
		switch i {
		case 8, 13, 18, 23:
			if r != '-' {
				return false
			}
		default:
			if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
				return false
			}
		}
	}
	return true
}
