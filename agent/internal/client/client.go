// Package client provides an authenticated HTTP client for the UseJunction
// control plane API.
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/usejunction/agent/internal/accountpolicy"
	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/controlurl"
)

// ErrUnauthorized means the device token is no longer accepted by the control plane.
var ErrUnauthorized = errors.New("unauthorized")

// APIClient is an authenticated HTTP client for the control plane.
type APIClient struct {
	baseURL string
	token   string
	http    *http.Client
}

// New creates an APIClient from an enrolled config.
func New(cfg *config.Config) *APIClient {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	// Parallel usage-batch uploads share this client; raise idle conns so
	// workers are not serialized on the default MaxIdleConnsPerHost=2.
	transport.MaxIdleConns = 32
	transport.MaxIdleConnsPerHost = 8
	return &APIClient{
		baseURL: cfg.ControlPlaneURL,
		token:   cfg.DeviceToken,
		http: &http.Client{
			// Keep slightly above Vercel ingest maxDuration (60s) so the client
			// fails soon after a FUNCTION_INVOCATION_TIMEOUT instead of waiting
			// an extra ~30s on a dead connection.
			Timeout:   65 * time.Second,
			Transport: transport,
		},
	}
}

func (c *APIClient) post(path string, body any) error {
	return c.postJSON(context.Background(), path, body, nil)
}

func (c *APIClient) postJSON(ctx context.Context, path string, body any, out any) error {
	if err := controlurl.Validate(c.baseURL); err != nil {
		return err
	}
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return ErrUnauthorized
	}
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("POST %s returned %d: %s", path, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return fmt.Errorf("decode POST %s: %w", path, err)
		}
	}
	return nil
}

// --- Payload types ----------------------------------------------------------

type HeartbeatPayload struct {
	Hostname           string `json:"hostname"`
	OS                 string `json:"os"`
	Architecture       string `json:"architecture"`
	AgentVersion       string `json:"agentVersion"`
	LocalEndpoint      string `json:"localEndpoint,omitempty"`
	LocalSyncToken     string `json:"localSyncToken,omitempty"`
	RemoteSyncProtocol int    `json:"remoteSyncProtocol,omitempty"`
	// TimeZone is the machine IANA timezone when known (e.g. Asia/Colombo).
	TimeZone string `json:"timeZone,omitempty"`
	// LastCollect carries the outcome of the most recent scheduled collect so the
	// control plane can alert (Slack) on failures/timeouts without a separate
	// endpoint. Sent at most once per collect (report-once on the agent side).
	LastCollect *CollectStatus `json:"lastCollect,omitempty"`
}

// CollectStatus is a compact summary of one scheduled collect cycle.
// Status is one of: "ok", "queued", "failed", "timeout".
type CollectStatus struct {
	Status     string   `json:"status"`
	At         string   `json:"at,omitempty"`
	DurationMs int64    `json:"durationMs,omitempty"`
	Error      string   `json:"error,omitempty"`
	Warnings   []string `json:"warnings,omitempty"`
}

type AgentUpdateDirective struct {
	ReleaseID     string               `json:"releaseId"`
	AttemptID     string               `json:"attemptId"`
	TargetVersion string               `json:"targetVersion"`
	Urgency       string               `json:"urgency"`
	ArtifactURL   string               `json:"artifactUrl"`
	ArtifactKey   string               `json:"artifactKey"`
	SHA256        string               `json:"sha256"`
	Size          int64                `json:"size"`
	EligibleAt    string               `json:"eligibleAt"`
	Manifest      AgentReleaseManifest `json:"manifest"`
}

type AgentReleaseArtifact struct {
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type AgentReleaseManifest struct {
	SchemaVersion int                             `json:"schemaVersion"`
	Version       string                          `json:"version"`
	PublishedAt   string                          `json:"publishedAt"`
	Urgency       string                          `json:"urgency"`
	RolloutHours  int                             `json:"rolloutHours"`
	Artifacts     map[string]AgentReleaseArtifact `json:"artifacts"`
	SigningKeyID  string                          `json:"signingKeyId"`
	Signature     string                          `json:"signature"`
}

type HeartbeatResponse struct {
	OK        bool                  `json:"ok"`
	DeviceID  string                `json:"deviceId"`
	Update    *AgentUpdateDirective `json:"update,omitempty"`
	Uninstall bool                  `json:"uninstall,omitempty"`
	// FullUsageRescanDay is the UTC YYYY-MM-DD sealed by the daily usage refresh
	// cron. Agents run one full local usage rescan when this exceeds their
	// persisted lastFullUsageRescanDay.
	FullUsageRescanDay string `json:"fullUsageRescanDay,omitempty"`
}

type AblyTokenRequest struct {
	KeyName    string `json:"keyName,omitempty"`
	TTL        int64  `json:"ttl,omitempty"`
	Capability string `json:"capability,omitempty"`
	ClientID   string `json:"clientId,omitempty"`
	Timestamp  int64  `json:"timestamp,omitempty"`
	Nonce      string `json:"nonce,omitempty"`
	MAC        string `json:"mac,omitempty"`
}

type RemoteSyncBootstrapResponse struct {
	OK       bool `json:"ok"`
	Realtime struct {
		Provider     string           `json:"provider"`
		Protocol     int              `json:"protocol"`
		Channels     []string         `json:"channels"`
		TokenRequest AblyTokenRequest `json:"tokenRequest"`
	} `json:"realtime"`
}

type RemoteSyncTarget struct {
	ID        string `json:"id"`
	RequestID string `json:"requestId"`
	Scope     string `json:"scope"`
	ExpiresAt string `json:"expiresAt"`
}

type RemoteSyncClaimResponse struct {
	OK             bool               `json:"ok"`
	LeaseToken     string             `json:"leaseToken"`
	LeaseExpiresAt string             `json:"leaseExpiresAt"`
	Targets        []RemoteSyncTarget `json:"targets"`
}

type RemoteSyncReport struct {
	LeaseToken   string   `json:"leaseToken"`
	TargetIDs    []string `json:"targetIds"`
	Status       string   `json:"status"`
	Tools        int      `json:"tools,omitempty"`
	Accounts     int      `json:"accounts,omitempty"`
	Quotas       int      `json:"quotas,omitempty"`
	UsageRows    int      `json:"usageRows,omitempty"`
	Warnings     []string `json:"warnings,omitempty"`
	ErrorMessage string   `json:"errorMessage,omitempty"`
}

type RemoteSyncReportResponse struct {
	OK      bool `json:"ok"`
	Updated int  `json:"updated"`
}

type AgentUpdateEvent struct {
	AttemptID      string `json:"attemptId"`
	EventID        string `json:"eventId"`
	ReleaseVersion string `json:"releaseVersion"`
	Event          string `json:"event"`
	CurrentVersion string `json:"currentVersion,omitempty"`
	TargetVersion  string `json:"targetVersion"`
	Stage          string `json:"stage,omitempty"`
	ErrorCode      string `json:"errorCode,omitempty"`
}

type AgentUpdateCheckResponse struct {
	OK     bool                  `json:"ok"`
	Update *AgentUpdateDirective `json:"update,omitempty"`
}

type ToolReport struct {
	ToolName   string `json:"toolName"`
	Detected   bool   `json:"detected"`
	Configured bool   `json:"configured"`
	ConfigPath string `json:"configPath,omitempty"`
	Version    string `json:"version,omitempty"`
}

type LocalModelReport struct {
	Provider  string `json:"provider"`
	ModelName string `json:"modelName"`
	Size      string `json:"size,omitempty"`
	Running   bool   `json:"running"`
}

type AccountReport struct {
	ToolName    string `json:"toolName"`
	AccountKey  string `json:"accountKey,omitempty"`
	Email       string `json:"email,omitempty"`
	Plan        string `json:"plan,omitempty"`
	LoginMethod string `json:"loginMethod"`
	AuthPresent bool   `json:"authPresent"`
}

type QuotaReport struct {
	ToolName         string   `json:"toolName"`
	WindowType       string   `json:"windowType"`
	UsedPercent      *float64 `json:"usedPercent,omitempty"`
	ResetAt          *string  `json:"resetAt,omitempty"`
	CreditsRemaining *float64 `json:"creditsRemaining,omitempty"`
	Source           string   `json:"source"`
}

type UsageAggregate struct {
	Date               string            `json:"date"`
	ToolName           string            `json:"toolName"`
	Model              string            `json:"model"`
	InputTokens        int               `json:"inputTokens"`
	OutputTokens       int               `json:"outputTokens"`
	CacheReadTokens    int               `json:"cacheReadTokens"`
	CacheWriteTokens   int               `json:"cacheWriteTokens,omitempty"`
	ReasoningTokens    int               `json:"reasoningTokens,omitempty"`
	EstimatedCost      float64           `json:"estimatedCost"`
	SuggestedLines     int               `json:"suggestedLines,omitempty"`
	AcceptedLines      int               `json:"acceptedLines,omitempty"`
	AddedLines         int               `json:"addedLines,omitempty"`
	DeletedLines       int               `json:"deletedLines,omitempty"`
	Commits            int               `json:"commits,omitempty"`
	AiPercent          *float64          `json:"aiPercent,omitempty"`
	Requests           int               `json:"requests,omitempty"`
	Source             string            `json:"source,omitempty"`
	Verified           bool              `json:"verified,omitempty"`
	MetricKind         string            `json:"metricKind,omitempty"`
	CostKind           string            `json:"costKind,omitempty"`
	TokenSemantics     string            `json:"tokenSemantics,omitempty"`
	CalculationVersion string            `json:"calculationVersion,omitempty"`
	Repository         *RepositoryReport `json:"repository,omitempty"`
	Metadata           map[string]any    `json:"metadata,omitempty"`
}

type SignalsPolicy struct {
	Enabled                 bool     `json:"enabled"`
	RetentionDays           int      `json:"retentionDays"`
	CollectionMode          string   `json:"collectionMode"`
	ExcludedApps            []string `json:"excludedApps"`
	ExcludedDomains         []string `json:"excludedDomains"`
	StoreEvents             bool     `json:"storeEvents"`
	WorkExtractionEnabled   bool     `json:"workExtractionEnabled"`
	WorkExtractionStartedAt string   `json:"workExtractionStartedAt,omitempty"`
	UpdatedAt               string   `json:"updatedAt,omitempty"`
}

type SignalsStep struct {
	App       string  `json:"app,omitempty"`
	Domain    *string `json:"domain"`
	StartedAt string  `json:"startedAt"`
	EndedAt   string  `json:"endedAt"`
}

type SignalsSession struct {
	LocalID         string         `json:"localId"`
	StartedAt       string         `json:"startedAt"`
	EndedAt         string         `json:"endedAt"`
	DurationSeconds int            `json:"durationSeconds"`
	AITool          string         `json:"aiTool"`
	AppBefore       string         `json:"appBefore,omitempty"`
	DomainBefore    *string        `json:"domainBefore"`
	AppAfter        string         `json:"appAfter,omitempty"`
	DomainAfter     *string        `json:"domainAfter"`
	FlowSignature   string         `json:"flowSignature"`
	Confidence      float64        `json:"confidence"`
	CollectionMode  string         `json:"collectionMode"`
	Steps           []SignalsStep  `json:"steps"`
	Metadata        map[string]any `json:"metadata,omitempty"`
}

type RepositoryReport struct {
	Host  string `json:"host"`
	Owner string `json:"owner"`
	Name  string `json:"name"`
}

type WorkTraceLocation struct {
	Kind       string            `json:"kind,omitempty"`
	Project    string            `json:"project,omitempty"`
	Repository *RepositoryReport `json:"repository,omitempty"`
}

type WorkTraceStep struct {
	Kind string `json:"kind"`
	Name string `json:"name,omitempty"`
}

type WorkTraceStats struct {
	LinesAdded   int `json:"linesAdded,omitempty"`
	LinesRemoved int `json:"linesRemoved,omitempty"`
	FilesChanged int `json:"filesChanged,omitempty"`
}

type WorkTraceChurn struct {
	FilesRewritten int `json:"filesRewritten,omitempty"`
	RewriteEvents  int `json:"rewriteEvents,omitempty"`
}

type WorkTraceVerify struct {
	AfterEdit bool     `json:"afterEdit,omitempty"`
	Kinds     []string `json:"kinds,omitempty"`
}

type WorkTraceGitCommit struct {
	SHA          string `json:"sha"`
	Subject      string `json:"subject"`
	FilesChanged int    `json:"filesChanged,omitempty"`
	LinesAdded   int    `json:"linesAdded,omitempty"`
	LinesRemoved int    `json:"linesRemoved,omitempty"`
}

type WorkTraceGit struct {
	Branch    string               `json:"branch,omitempty"`
	Committed *bool                `json:"committed,omitempty"`
	PRNumber  int                  `json:"prNumber,omitempty"`
	Commits   []WorkTraceGitCommit `json:"commits,omitempty"`
}

// WorkTraceUnderstanding is derived episode claims. Never includes prompts or
// message bodies — only structured insights with confidence.
type WorkTraceUnderstanding struct {
	Version      int                               `json:"version"`
	Intent       string                            `json:"intent,omitempty"`
	IntentSource string                            `json:"intentSource,omitempty"` // summary|title|plan|user_turn_derived
	Context      *WorkTraceUnderstandingContext    `json:"context,omitempty"`
	Actors       *WorkTraceUnderstandingActors     `json:"actors,omitempty"`
	Sequence     *WorkTraceUnderstandingSequence   `json:"sequence,omitempty"`
	Attempts     *WorkTraceUnderstandingAttempts   `json:"attempts,omitempty"`
	Authorship   *WorkTraceUnderstandingAuthorship `json:"authorship,omitempty"`
	Acceptance   *WorkTraceUnderstandingAcceptance `json:"acceptance,omitempty"`
	Outcome      *WorkTraceUnderstandingOutcome    `json:"outcome,omitempty"`
	Confidence   *WorkTraceUnderstandingConfidence `json:"confidence,omitempty"`
}

type WorkTraceUnderstandingContext struct {
	Kinds        []string `json:"kinds,omitempty"`
	PrimaryFiles []string `json:"primaryFiles,omitempty"`
	Skills       []string `json:"skills,omitempty"`
}

type WorkTraceUnderstandingActors struct {
	Tool  string `json:"tool"`
	Model string `json:"model,omitempty"`
	Mode  string `json:"mode,omitempty"`
}

type WorkTraceUnderstandingSequence struct {
	Fingerprint    string `json:"fingerprint,omitempty"`
	UserTurns      int    `json:"userTurns,omitempty"`
	AssistantTurns int    `json:"assistantTurns,omitempty"`
	ToolCalls      int    `json:"toolCalls,omitempty"`
}

type WorkTraceUnderstandingAttempts struct {
	Score   int      `json:"score"`
	Signals []string `json:"signals,omitempty"`
}

type WorkTraceUnderstandingAuthorship struct {
	AIEditEvents    int     `json:"aiEditEvents,omitempty"`
	HumanEditEvents int     `json:"humanEditEvents,omitempty"`
	TabEditEvents   int     `json:"tabEditEvents,omitempty"`
	AIShare         float64 `json:"aiShare,omitempty"`
	RequestCount    int     `json:"requestCount,omitempty"`
}

type WorkTraceUnderstandingAcceptance struct {
	Status  string   `json:"status"` // unknown|likely_kept|mixed|abandoned
	Signals []string `json:"signals,omitempty"`
}

type WorkTraceUnderstandingOutcome struct {
	Status   string   `json:"status"` // unknown|in_progress|verified|committed|abandoned
	Evidence []string `json:"evidence,omitempty"`
}

type WorkTraceUnderstandingConfidence struct {
	Intent     float64 `json:"intent,omitempty"`
	Authorship float64 `json:"authorship,omitempty"`
	Acceptance float64 `json:"acceptance,omitempty"`
	Outcome    float64 `json:"outcome,omitempty"`
}

// WorkTrace is structured activity for a work session. Full assistant chat and
// file contents are never included. Allowlisted prose lives under userTurns[].text
// and changeNarrative.text only.
type WorkTrace struct {
	Approach         string                    `json:"approach,omitempty"`
	Location         *WorkTraceLocation        `json:"location,omitempty"`
	Skills           []string                  `json:"skills,omitempty"`
	Tools            []string                  `json:"tools,omitempty"`
	Files            []string                  `json:"files,omitempty"`
	Steps            []WorkTraceStep           `json:"steps,omitempty"`
	Stats            *WorkTraceStats           `json:"stats,omitempty"`
	DurationSeconds  int                       `json:"durationSeconds,omitempty"`
	Phases           []string                  `json:"phases,omitempty"`
	PhaseFingerprint string                    `json:"phaseFingerprint,omitempty"`
	Churn            *WorkTraceChurn           `json:"churn,omitempty"`
	Verify           *WorkTraceVerify          `json:"verify,omitempty"`
	Languages        []string                  `json:"languages,omitempty"`
	TestInvolved     *bool                     `json:"testInvolved,omitempty"`
	SkillCounts      map[string]int            `json:"skillCounts,omitempty"`
	Git              *WorkTraceGit             `json:"git,omitempty"`
	Understanding    *WorkTraceUnderstanding   `json:"understanding,omitempty"`
	UserTurns        []WorkTraceUserTurn       `json:"userTurns,omitempty"`
	FileChangelog    []WorkTraceFileChange     `json:"fileChangelog,omitempty"`
	ChangeNarrative  *WorkTraceChangeNarrative `json:"changeNarrative,omitempty"`
}

// WorkTraceUserTurn is a user-only turn. Never store assistant replies here.
type WorkTraceUserTurn struct {
	At    string                `json:"at,omitempty"`
	Text  string                `json:"text"`
	Files []WorkTraceFileChange `json:"files,omitempty"` // files touched after this turn, before the next
}

// WorkTraceChangeNarrative is a clipped, redacted "what changed" summary —
// either from a tool-provided conversation summary or the final assistant wrap-up.
// Never store full chat transcripts here.
type WorkTraceChangeNarrative struct {
	Text    string   `json:"text"`
	At      string   `json:"at,omitempty"`
	Source  string   `json:"source"` // assistant_final|conversation_summary|composer_subtitle
	Bullets []string `json:"bullets,omitempty"`
}

// WorkTraceFileChange is a basename-level change log entry (no file contents).
type WorkTraceFileChange struct {
	File   string `json:"file"`
	Op     string `json:"op"`               // read|write|create|delete|edit|unknown
	Source string `json:"source,omitempty"` // composer|human|tab|tool|unknown
	Events int    `json:"events,omitempty"`
}

type WorkSession struct {
	LocalID        string            `json:"localId"`
	ToolName       string            `json:"toolName"`
	Model          string            `json:"model,omitempty"`
	Mode           string            `json:"mode,omitempty"`
	Title          string            `json:"title,omitempty"`
	Tldr           string            `json:"tldr,omitempty"`
	Overview       string            `json:"overview,omitempty"`
	StartedAt      string            `json:"startedAt,omitempty"`
	EndedAt        string            `json:"endedAt,omitempty"`
	ObservedAt     string            `json:"observedAt"`
	ToolCallCounts map[string]int    `json:"toolCallCounts,omitempty"`
	Trace          *WorkTrace        `json:"trace,omitempty"`
	Repository     *RepositoryReport `json:"repository,omitempty"`
	Source         string            `json:"source"`
	Metadata       map[string]any    `json:"metadata,omitempty"`
}

// --- API calls --------------------------------------------------------------

func (c *APIClient) Heartbeat(p HeartbeatPayload) (*HeartbeatResponse, error) {
	var out HeartbeatResponse
	if err := c.postJSON(context.Background(), "/api/devices/heartbeat", p, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *APIClient) BootstrapRemoteSync(ctx context.Context) (*RemoteSyncBootstrapResponse, error) {
	var out RemoteSyncBootstrapResponse
	if err := c.postJSON(ctx, "/api/devices/sync/bootstrap", map[string]any{}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *APIClient) ClaimRemoteSync(ctx context.Context) (*RemoteSyncClaimResponse, error) {
	var out RemoteSyncClaimResponse
	if err := c.postJSON(ctx, "/api/devices/sync/claim", map[string]any{}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *APIClient) ReportRemoteSync(ctx context.Context, report RemoteSyncReport) (*RemoteSyncReportResponse, error) {
	var out RemoteSyncReportResponse
	if err := c.postJSON(ctx, "/api/devices/sync/report", report, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *APIClient) ReportAgentUpdate(event AgentUpdateEvent) error {
	return c.post("/api/devices/agent-update", event)
}

func (c *APIClient) CheckAgentUpdate() (*AgentUpdateDirective, error) {
	var out AgentUpdateCheckResponse
	if err := c.postJSON(context.Background(), "/api/devices/agent-update/check", map[string]any{}, &out); err != nil {
		return nil, err
	}
	return out.Update, nil
}

func (c *APIClient) ReportLocalModels(models []LocalModelReport) error {
	return c.post("/api/devices/local-models", map[string]any{"models": models})
}

func (c *APIClient) ReportAccounts(accounts []AccountReport) error {
	return c.post("/api/devices/accounts", map[string]any{"accounts": accounts})
}

func (c *APIClient) ReportQuotas(quotas []QuotaReport) error {
	return c.post("/api/devices/quota", map[string]any{"quotas": quotas})
}

type SyncManifestPartition struct {
	PartitionKey string            `json:"partitionKey"`
	Date         string            `json:"date"`
	Tool         string            `json:"tool"`
	Model        string            `json:"model"`
	Source       string            `json:"source"`
	Repository   *RepositoryReport `json:"repository,omitempty"`
	ContentHash  string            `json:"contentHash"`
	RowCount     int               `json:"rowCount"`
}

type StartUsageSyncResponse struct {
	SyncRunID       string   `json:"syncRunId"`
	DeltaPartitions []string `json:"deltaPartitions"`
	ExpectedRows    int      `json:"expectedRows"`
	Status          string   `json:"status"`
	ToolsApplied    string   `json:"toolsApplied,omitempty"`
	ToolsWarning    string   `json:"toolsWarning,omitempty"`
	AccountsApplied string   `json:"accountsApplied,omitempty"`
	AccountsWarning string   `json:"accountsWarning,omitempty"`
	QuotasApplied   string   `json:"quotasApplied,omitempty"`
	QuotasWarning   string   `json:"quotasWarning,omitempty"`
}

type ToolsSyncSidecar struct {
	ContentHash string       `json:"contentHash"`
	Items       []ToolReport `json:"items"`
}

type AccountsSyncSidecar struct {
	ContentHash string          `json:"contentHash"`
	Items       []AccountReport `json:"items"`
}

type QuotasSyncSidecar struct {
	ContentHash string        `json:"contentHash"`
	Items       []QuotaReport `json:"items"`
}

type StartUsageSyncOptions struct {
	Tools    *ToolsSyncSidecar
	Accounts *AccountsSyncSidecar
	Quotas   *QuotasSyncSidecar
}

func (c *APIClient) StartUsageSync(ctx context.Context, partitions []SyncManifestPartition, opts *StartUsageSyncOptions) (*StartUsageSyncResponse, error) {
	body := map[string]any{"partitions": partitions}
	if opts != nil {
		if opts.Tools != nil {
			body["tools"] = opts.Tools
		}
		if opts.Accounts != nil {
			body["accounts"] = opts.Accounts
		}
		if opts.Quotas != nil {
			body["quotas"] = opts.Quotas
		}
	}
	var out StartUsageSyncResponse
	if err := c.postJSON(ctx, "/api/ingest/sync/usage/start", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type UploadUsageSyncChunkResponse struct {
	Upserted       int  `json:"upserted"`
	Duplicate      bool `json:"duplicate"`
	ReceivedChunks int  `json:"receivedChunks"`
	ReceivedRows   int  `json:"receivedRows"`
}

func (c *APIClient) UploadUsageSyncChunk(ctx context.Context, syncRunID, chunkID string, aggregates []UsageAggregate) (int, error) {
	var out UploadUsageSyncChunkResponse
	err := c.postJSON(ctx, "/api/ingest/sync/usage/chunk", map[string]any{
		"syncRunId":  syncRunID,
		"chunkId":    chunkID,
		"aggregates": aggregates,
		"observedAt": time.Now().UTC().Format(time.RFC3339Nano),
	}, &out)
	if err != nil {
		if isPayloadTooLarge(err) && len(aggregates) > 1 {
			mid := len(aggregates) / 2
			left, errLeft := c.UploadUsageSyncChunk(ctx, syncRunID, chunkID+"a", aggregates[:mid])
			if errLeft != nil {
				return left, errLeft
			}
			right, errRight := c.UploadUsageSyncChunk(ctx, syncRunID, chunkID+"b", aggregates[mid:])
			return left + right, errRight
		}
		return 0, err
	}
	return out.Upserted, nil
}

type CommitUsageSyncResponse struct {
	Status            string   `json:"status"`
	ReceivedChunks    int      `json:"receivedChunks"`
	ReceivedRows      int      `json:"receivedRows"`
	MissingPartitions []string `json:"missingPartitions"`
	DirtyRemaining    int      `json:"dirtyRemaining"`
}

func (c *APIClient) CommitUsageSync(ctx context.Context, syncRunID string, expectedChunks int, remainingPartitions ...int) (*CommitUsageSyncResponse, error) {
	payload := map[string]any{
		"syncRunId":      syncRunID,
		"expectedChunks": expectedChunks,
	}
	if len(remainingPartitions) > 0 {
		payload["remainingPartitions"] = remainingPartitions[0]
	}
	var out CommitUsageSyncResponse
	if err := c.postJSON(ctx, "/api/ingest/sync/usage/commit", payload, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func isPayloadTooLarge(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "returned 413") || strings.Contains(msg, "request body too large")
}

func (c *APIClient) SignalsPolicy() (*SignalsPolicy, error) {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+"/api/devices/signals-policy", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("GET /api/devices/signals-policy returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var out struct {
		Policy SignalsPolicy `json:"policy"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	return &out.Policy, nil
}

type AccountPolicyPatch struct {
	Scope      string `json:"scope,omitempty"`
	ToolName   string `json:"toolName"`
	AccountKey string `json:"accountKey"`
	Stream     string `json:"stream,omitempty"`
	Enabled    bool   `json:"enabled"`
}

func (c *APIClient) AccountPolicy() (*accountpolicy.Policy, error) {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+"/api/devices/account-policy", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("GET /api/devices/account-policy returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var out accountpolicy.Policy
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *APIClient) PatchAccountPolicy(patch AccountPolicyPatch) (*accountpolicy.Account, error) {
	if err := controlurl.Validate(c.baseURL); err != nil {
		return nil, err
	}
	data, err := json.Marshal(patch)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPatch, c.baseURL+"/api/devices/account-policy", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, ErrUnauthorized
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("PATCH /api/devices/account-policy returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var out struct {
		Account accountpolicy.Account `json:"account"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	return &out.Account, nil
}

func (c *APIClient) ReportSignalsSessions(sessions []SignalsSession) error {
	return c.post("/api/ingest/signals-sessions", map[string]any{"sessions": sessions})
}

func (c *APIClient) ReportWorkSessions(sessions []WorkSession) error {
	return c.post("/api/ingest/work-sessions", map[string]any{"sessions": sessions})
}

// --- Enrollment (no Bearer token needed) ------------------------------------

type EnrollRequest struct {
	Token        string `json:"token"`
	Email        string `json:"email,omitempty"`
	Name         string `json:"name,omitempty"`
	Hostname     string `json:"hostname"`
	OS           string `json:"os"`
	Architecture string `json:"architecture"`
	AgentVersion string `json:"agentVersion"`
}

type EnrollResponse struct {
	DeviceID    string      `json:"deviceId"`
	UserID      string      `json:"userId"`
	OrgID       string      `json:"orgId"`
	DeviceToken string      `json:"deviceToken"`
	GatewayURL  string      `json:"gatewayUrl"`
	Otel        *EnrollOtel `json:"otel,omitempty"`
}

type EnrollOtel struct {
	Enabled         bool   `json:"enabled"`
	MetricsEndpoint string `json:"metricsEndpoint"`
}

// Enroll sends the enrollment request to baseURL without authentication.
func Enroll(baseURL string, req EnrollRequest) (*EnrollResponse, error) {
	if err := controlurl.Validate(baseURL); err != nil {
		return nil, err
	}
	data, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequest(http.MethodPost, baseURL+"/api/enroll", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	httpClient := &http.Client{Timeout: 15 * time.Second}
	resp, err := httpClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(body))
		var errResp struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(body, &errResp) == nil && errResp.Error != "" {
			msg = errResp.Error
		}
		return nil, fmt.Errorf("enroll failed (%d): %s", resp.StatusCode, msg)
	}

	var out EnrollResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("invalid enroll response: %w", err)
	}
	return &out, nil
}
