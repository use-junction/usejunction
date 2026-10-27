package scan

import "testing"

func TestRateForModelCurrentClaudeModels(t *testing.T) {
	generic := rateForModel("claude")

	opus55 := rateForModel("claude-opus-5-5")
	if opus55 != (ModelRate{4, 20, 0.2, 5}) {
		t.Fatalf("claude-opus-5-5 should use Opus 5.5 rates, got %+v", opus55)
	}
	if opus55 == generic {
		t.Fatalf("claude-opus-5-5 fell through to the generic claude row")
	}
	if got := rateForModel("claude-opus-5"); got != (ModelRate{5, 25, 0.5, 6.25}) {
		t.Fatalf("claude-opus-5 should use Opus 5 rates, got %+v", got)
	}

	sonnet55 := rateForModel("claude-sonnet-5-5")
	if sonnet55 != (ModelRate{2, 10, 0.2, 2.5}) {
		t.Fatalf("claude-sonnet-5-5 should use Sonnet 5.5 rates, got %+v", sonnet55)
	}
	if sonnet55 == generic {
		t.Fatalf("claude-sonnet-5-5 fell through to the generic claude row")
	}
	if got := rateForModel("claude-sonnet-5"); got != (ModelRate{2, 10, 0.2, 2.5}) {
		t.Fatalf("claude-sonnet-5 should use Sonnet 5 rates, got %+v", got)
	}

	if got := rateForModel("claude-fable-5-1"); got.CacheReadPer1M != 0.25 {
		t.Fatalf("claude-fable-5-1 cache read should be $0.25/M, got %+v", got)
	}
	if got := rateForModel("claude-haiku-5-5"); got != (ModelRate{0.1, 0.5, 0.01, 0.125}) {
		t.Fatalf("claude-haiku-5-5 should use Haiku 5.5 rates, got %+v", got)
	}
	// Previous-generation ids must keep their own rows.
	if got := rateForModel("claude-opus-4-8"); got != (ModelRate{5, 25, 0.5, 6.25}) {
		t.Fatalf("claude-opus-4-8 should use Opus 4 rates, got %+v", got)
	}
	if got := rateForModel("claude-sonnet-4-5-20250929"); got != (ModelRate{3, 15, 0.3, 3.75}) {
		t.Fatalf("claude-sonnet-4-5 should use Sonnet 4 rates, got %+v", got)
	}
}

func TestRateForModelGPT6Family(t *testing.T) {
	if got := rateForModel("gpt-6-astra"); got != (ModelRate{10, 50, 1, 0}) {
		t.Fatalf("gpt-6-astra: %+v", got)
	}
	if got := rateForModel("gpt-6-sol"); got != (ModelRate{2, 10, 0.2, 0}) {
		t.Fatalf("gpt-6-sol: %+v", got)
	}
	if got := rateForModel("gpt-6.1-sol"); got != (ModelRate{2, 10, 0.1, 0}) {
		t.Fatalf("gpt-6.1-sol: %+v", got)
	}
	if got := rateForModel("gpt-6-luna"); got != (ModelRate{0.1, 0.5, 0.01, 0}) {
		t.Fatalf("gpt-6-luna: %+v", got)
	}
	if got := rateForModel("gpt-6-unknown"); got != defaultRates {
		t.Fatalf("unlisted gpt-6 variant should use default rates: %+v", got)
	}
}
