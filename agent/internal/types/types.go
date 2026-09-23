package types

// ToolStatus describes a detected AI coding tool.
type ToolStatus struct {
	ToolName   string `json:"toolName"`
	Detected   bool   `json:"detected"`
	Configured bool   `json:"configured"`
	ConfigPath string `json:"configPath,omitempty"`
	Version    string `json:"version,omitempty"`
}

// ToolAccount describes an authenticated identity for a tool.
type ToolAccount struct {
	ToolName    string `json:"toolName"`
	AccountKey  string `json:"accountKey,omitempty"`
	Email       string `json:"email,omitempty"`
	Plan        string `json:"plan,omitempty"`
	LoginMethod string `json:"loginMethod"`
	AuthPresent bool   `json:"authPresent"`
}

// QuotaSnapshot is a point-in-time quota reading.
type QuotaSnapshot struct {
	ToolName         string   `json:"toolName"`
	WindowType       string   `json:"windowType"`
	UsedPercent      *float64 `json:"usedPercent,omitempty"`
	ResetAt          *string  `json:"resetAt,omitempty"`
	CreditsRemaining *float64 `json:"creditsRemaining,omitempty"`
	Source           string   `json:"source"`
}

// MetricKind separates billing usage from productivity-only observations.
type MetricKind string

const (
	MetricKindUsage        MetricKind = "usage"
	MetricKindProductivity MetricKind = "productivity"
)

// CostKind classifies how dollar amounts should be interpreted.
type CostKind string

const (
	CostKindVerifiedUsage CostKind = "verified_usage"
	CostKindEstimatedAPI  CostKind = "estimated_api"
	CostKindActualSpend   CostKind = "actual_spend"
)

// TokenSemantics documents how input/cache buckets relate for pricing.
type TokenSemantics string

const (
	TokenSemanticsOpenAI    TokenSemantics = "openai_subset_cache"
	TokenSemanticsAnthropic TokenSemantics = "anthropic_additive_cache"
	TokenSemanticsVendor    TokenSemantics = "vendor_reported"
)

// DailyUsage is token/cost data aggregated by date + model.
type DailyUsage struct {
	Date               string              `json:"date"`
	ToolName           string              `json:"toolName"`
	Model              string              `json:"model"`
	InputTokens        int                 `json:"inputTokens"`
	OutputTokens       int                 `json:"outputTokens"`
	CacheReadTokens    int                 `json:"cacheReadTokens"`
	CacheWriteTokens   int                 `json:"cacheWriteTokens,omitempty"`
	ReasoningTokens    int                 `json:"reasoningTokens,omitempty"`
	EstimatedCost      float64             `json:"estimatedCost"`
	SuggestedLines     int                 `json:"suggestedLines,omitempty"`
	AcceptedLines      int                 `json:"acceptedLines,omitempty"`
	AddedLines         int                 `json:"addedLines,omitempty"`
	DeletedLines       int                 `json:"deletedLines,omitempty"`
	Commits            int                 `json:"commits,omitempty"`
	AiPercent          *float64            `json:"aiPercent,omitempty"`
	Requests           int                 `json:"requests,omitempty"`
	Source             string              `json:"source,omitempty"`
	Verified           bool                `json:"verified,omitempty"`
	MetricKind         MetricKind          `json:"metricKind,omitempty"`
	CostKind           CostKind            `json:"costKind,omitempty"`
	TokenSemantics     TokenSemantics      `json:"tokenSemantics,omitempty"`
	CalculationVersion string              `json:"calculationVersion,omitempty"`
	Repository         *RepositoryIdentity `json:"repository,omitempty"`
	Metadata           map[string]any      `json:"metadata,omitempty"`
}

// RepositoryIdentity is the canonical remote identity of a repository. Local
// filesystem paths are deliberately never included in reports.
type RepositoryIdentity struct {
	Host  string `json:"host"`
	Owner string `json:"owner"`
	Name  string `json:"name"`
}

// LocalModelInfo describes a locally running model (Ollama, LM Studio, etc.).
type LocalModelInfo struct {
	Provider  string `json:"provider"`
	ModelName string `json:"modelName"`
	Size      string `json:"size,omitempty"`
	Running   bool   `json:"running"`
}
