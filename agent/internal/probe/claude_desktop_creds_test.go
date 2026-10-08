package probe

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/pbkdf2"
	"crypto/sha1"
	"testing"
	"time"
)

func oscryptEncrypt(t *testing.T, plaintext, secret []byte) []byte {
	t.Helper()
	key, err := pbkdf2.Key(sha1.New, string(secret), []byte(oscryptSalt), oscryptIterations, oscryptKeyLen)
	if err != nil {
		t.Fatalf("pbkdf2: %v", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatalf("aes: %v", err)
	}
	pad := aes.BlockSize - len(plaintext)%aes.BlockSize
	padded := append(append([]byte{}, plaintext...), bytes.Repeat([]byte{byte(pad)}, pad)...)
	iv := bytes.Repeat([]byte{' '}, aes.BlockSize)
	out := make([]byte, len(padded))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(out, padded)
	return append([]byte("v10"), out...)
}

func TestOscryptDecryptRoundTrip(t *testing.T) {
	secret := []byte("test-safe-storage-secret")
	want := []byte(`{"hello":"world"}`)
	got, err := oscryptDecrypt(oscryptEncrypt(t, want, secret), secret)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("round trip: got %q want %q", got, want)
	}
}

func TestParseClaudeDesktopTokens(t *testing.T) {
	// uuid appears only as the map key; identity + token are nested.
	plaintext := []byte(`{
      "11111111-2222-3333-4444-555555555555": {
        "profile": {
          "emailAddress": "dev@themakers.global",
          "organizationUuid": "org-team",
          "subscriptionType": "team_standard"
        },
        "claudeAiOauth": {
          "accessToken": "sk-ant-oat-secret",
          "rateLimitTier": "default_claude_max_20x",
          "expiresAt": 9999999999999
        }
      },
      "settings": {"theme": "dark"}
    }`)
	got := parseClaudeDesktopTokens(plaintext)
	if len(got) != 1 {
		t.Fatalf("got %d tokens, want 1: %+v", len(got), got)
	}
	tok := got[0]
	if tok.AccountUUID != "11111111-2222-3333-4444-555555555555" {
		t.Fatalf("uuid not captured from key: %+v", tok)
	}
	if tok.Email != "dev@themakers.global" || tok.OrgUUID != "org-team" {
		t.Fatalf("identity wrong: %+v", tok)
	}
	if tok.AccessToken != "sk-ant-oat-secret" {
		t.Fatalf("token not captured: %+v", tok)
	}
	// subscriptionType team_standard overrides the max tier → stays team-standard.
	if tok.Plan != "team-standard" {
		t.Fatalf("plan: got %q want team-standard", tok.Plan)
	}
}

func TestParseClaudeDesktopTokensRequiresAccessToken(t *testing.T) {
	plaintext := []byte(`{"acct":{"accountUuid":"u1","emailAddress":"a@b.com","subscriptionType":"pro"}}`)
	if got := parseClaudeDesktopTokens(plaintext); len(got) != 0 {
		t.Fatalf("objects without an access token must be skipped, got %+v", got)
	}
}

func TestClaudeDesktopTokenExpiry(t *testing.T) {
	now := time.UnixMilli(2_000_000_000_000) // 2033
	cases := []struct {
		name string
		ms   int64
		want bool
	}{
		{"unknown", 0, false},
		{"future-ms", 3_000_000_000_000, false},
		{"past-ms", 1_000_000_000_000, true},
		{"future-seconds", 3_000_000_000, false},
		{"past-seconds", 1_600_000_000, true},
	}
	for _, c := range cases {
		if got := (claudeDesktopToken{ExpiresAtMs: c.ms}).expired(now); got != c.want {
			t.Errorf("%s: expired=%v want %v", c.name, got, c.want)
		}
	}
}
