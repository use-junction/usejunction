// Package localsync runs a localhost-only HTTP server so the dashboard can
// trigger an on-demand collect and bounce metrics to the control plane.
package localsync

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/usejunction/agent/internal/config"
)

// ProgressFunc records the current phase for a running sync job.
type ProgressFunc func(step, message string)

// SyncFunc runs a collect+report cycle. refresh=true forces a full local usage
// rescan (bypasses scan snapshots). Scheduled collects use refresh=false
// (incremental) unless the control plane sealed a newer fullUsageRescanDay.
// Usage/work uploads remain delta-filtered (fingerprints + watermark).
type SyncFunc func(ctx context.Context, refresh bool, progress ProgressFunc) (tools, accounts, quotas, usage int, warnings []string, err error)

type syncJob struct {
	ID         string           `json:"jobId"`
	Status     string           `json:"status"`
	Step       string           `json:"step"`
	Message    string           `json:"message"`
	Tools      int              `json:"tools"`
	Accounts   int              `json:"accounts"`
	Quotas     int              `json:"quotas"`
	UsageRows  int              `json:"usageRows"`
	StartedAt  string           `json:"startedAt"`
	UpdatedAt  string           `json:"updatedAt"`
	FinishedAt string           `json:"finishedAt,omitempty"`
	Error      string           `json:"error,omitempty"`
	Warnings   []string         `json:"warnings,omitempty"`
	Durations  map[string]int64 `json:"durationsMs,omitempty"`

	stepStarted time.Time
}

// Server is the loopback metrics trigger.
type Server struct {
	cfg     *config.Config
	syncFn  SyncFunc
	mu      sync.Mutex
	last    time.Time
	active  *syncJob
	lastJob *syncJob
}

// New creates a localsync server. syncFn must be non-nil.
func New(cfg *config.Config, syncFn SyncFunc) *Server {
	return &Server{cfg: cfg, syncFn: syncFn}
}

// ListenAndServe binds 127.0.0.1 only and serves until the listener fails.
func (s *Server) ListenAndServe() error {
	port := s.cfg.LocalSyncPort
	if port <= 0 {
		port = config.DefaultLocalSyncPort
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return err
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.withCORS(s.handleHealth))
	mux.HandleFunc("/v1/sync/status", s.withCORS(s.handleSyncStatus))
	mux.HandleFunc("/v1/sync", s.withCORS(s.handleSync))
	mux.HandleFunc("/v1/metrics", s.withCORS(s.handleMetrics))
	mux.HandleFunc("/v1/accounts", s.withCORS(s.handleAccounts))
	srv := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	return srv.Serve(ln)
}

func (s *Server) withCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if s.originAllowed(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next(w, r)
	}
}

func (s *Server) originAllowed(origin string) bool {
	if origin == "" {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	if s.loopbackOriginAllowed(u) {
		return true
	}
	// Control plane + common local admin ports only. No gateway origins —
	// UseJunction does not route tools through a gateway.
	allowed := []string{
		s.cfg.ControlPlaneURL,
		"http://localhost:3000",
		"http://localhost:3001",
		"http://127.0.0.1:3000",
		"http://127.0.0.1:3001",
	}
	for _, a := range allowed {
		au, err := url.Parse(a)
		if err != nil || au.Scheme == "" || au.Host == "" {
			continue
		}
		if strings.EqualFold(au.Scheme, u.Scheme) && strings.EqualFold(au.Host, u.Host) {
			return true
		}
	}
	return false
}

func (s *Server) loopbackOriginAllowed(u *url.URL) bool {
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	host := u.Hostname()
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (s *Server) authorize(r *http.Request) bool {
	token := strings.TrimSpace(s.cfg.LocalSyncToken)
	if token == "" {
		return false
	}
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(strings.ToLower(auth), "bearer ") {
		got := strings.TrimSpace(auth[7:])
		return got == token
	}
	if q := r.URL.Query().Get("token"); q != "" {
		return q == token
	}
	return false
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":           true,
		"version":      config.Version,
		"syncProtocol": config.LocalSyncProtocol,
		"device":       s.cfg.DeviceID,
	})
}

func (s *Server) handleSync(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.authorize(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	refresh := r.URL.Query().Get("refresh") == "1" || r.URL.Query().Get("refresh") == "true"

	s.mu.Lock()
	if !refresh && time.Since(s.last) < 30*time.Second {
		last := s.last
		job := s.completedDebouncedJob(last)
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":         true,
			"debounced":  true,
			"jobId":      job.ID,
			"status":     job.Status,
			"step":       job.Step,
			"message":    job.Message,
			"observedAt": last.UTC().Format(time.RFC3339),
		})
		return
	}
	if s.active != nil && s.active.Status == "running" {
		job := s.cloneJobLocked(s.active)
		s.mu.Unlock()
		writeJSON(w, http.StatusAccepted, jobResponse(job))
		return
	}
	job := s.newJobLocked()
	s.mu.Unlock()

	go s.runJob(job.ID, refresh)
	writeJSON(w, http.StatusAccepted, jobResponse(job))
}

func (s *Server) handleSyncStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.authorize(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	jobID := r.URL.Query().Get("jobId")
	s.mu.Lock()
	var job *syncJob
	if s.active != nil && (jobID == "" || s.active.ID == jobID) {
		job = s.cloneJobLocked(s.active)
	} else if s.lastJob != nil && (jobID == "" || s.lastJob.ID == jobID) {
		job = s.cloneJobLocked(s.lastJob)
	}
	s.mu.Unlock()
	if job == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "sync job not found"})
		return
	}
	writeJSON(w, http.StatusOK, jobResponse(job))
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.authorize(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"deviceId": s.cfg.DeviceID,
		"endpoint": s.cfg.LocalSyncURL(),
		"note":     "Use POST /v1/sync to collect and bounce metrics",
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func (s *Server) newJobLocked() *syncJob {
	now := time.Now().UTC()
	job := &syncJob{
		ID:          randomJobID(),
		Status:      "running",
		Step:        "queued",
		Message:     "Preparing sync",
		StartedAt:   now.Format(time.RFC3339),
		UpdatedAt:   now.Format(time.RFC3339),
		Durations:   map[string]int64{},
		stepStarted: now,
	}
	s.active = job
	s.lastJob = job
	return s.cloneJobLocked(job)
}

func (s *Server) completedDebouncedJob(last time.Time) *syncJob {
	now := time.Now().UTC()
	return &syncJob{
		ID:         randomJobID(),
		Status:     "skipped",
		Step:       "debounce",
		Message:    "Already synced recently",
		StartedAt:  last.UTC().Format(time.RFC3339),
		UpdatedAt:  now.Format(time.RFC3339),
		FinishedAt: now.Format(time.RFC3339),
		Durations:  map[string]int64{},
	}
}

func (s *Server) runJob(jobID string, refresh bool) {
	ctx := context.Background()
	progress := func(step, message string) {
		s.updateJob(jobID, step, message)
	}
	tools, accounts, quotas, usage, warnings, err := s.syncFn(ctx, refresh, progress)
	s.finishJob(jobID, tools, accounts, quotas, usage, warnings, err)
}

func (s *Server) updateJob(jobID, step, message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active == nil || s.active.ID != jobID {
		return
	}
	now := time.Now().UTC()
	if s.active.Step != "" && !s.active.stepStarted.IsZero() {
		s.active.Durations[s.active.Step] += now.Sub(s.active.stepStarted).Milliseconds()
	}
	s.active.Step = step
	s.active.Message = message
	s.active.UpdatedAt = now.Format(time.RFC3339)
	s.active.stepStarted = now
}

func (s *Server) finishJob(jobID string, tools, accounts, quotas, usage int, warnings []string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active == nil || s.active.ID != jobID {
		return
	}
	now := time.Now().UTC()
	if s.active.Step != "" && !s.active.stepStarted.IsZero() {
		s.active.Durations[s.active.Step] += now.Sub(s.active.stepStarted).Milliseconds()
	}
	s.active.Tools = tools
	s.active.Accounts = accounts
	s.active.Quotas = quotas
	s.active.UsageRows = usage
	s.active.Warnings = warnings
	s.active.UpdatedAt = now.Format(time.RFC3339)
	s.active.FinishedAt = now.Format(time.RFC3339)
	if err != nil {
		fmt.Printf("[localsync] sync failed: %v\n", err)
		s.active.Status = "failed"
		s.active.Step = "failed"
		s.active.Message = "Sync failed"
		// Keep the dashboard message generic; details stay in the agent log.
		s.active.Error = "Sync failed"
	} else {
		s.active.Status = "succeeded"
		s.active.Step = "complete"
		s.active.Message = "Sync complete"
		s.last = now
	}
	s.lastJob = s.cloneJobLocked(s.active)
	s.active = nil
}

func (s *Server) cloneJobLocked(job *syncJob) *syncJob {
	if job == nil {
		return nil
	}
	out := *job
	out.Warnings = append([]string(nil), job.Warnings...)
	out.Durations = map[string]int64{}
	for key, value := range job.Durations {
		out.Durations[key] = value
	}
	return &out
}

func jobResponse(job *syncJob) map[string]any {
	return map[string]any{
		"ok":          job.Status != "failed",
		"jobId":       job.ID,
		"status":      job.Status,
		"step":        job.Step,
		"message":     job.Message,
		"tools":       job.Tools,
		"accounts":    job.Accounts,
		"quotas":      job.Quotas,
		"usageRows":   job.UsageRows,
		"startedAt":   job.StartedAt,
		"updatedAt":   job.UpdatedAt,
		"finishedAt":  job.FinishedAt,
		"error":       job.Error,
		"warnings":    job.Warnings,
		"durationsMs": job.Durations,
	}
}

func randomJobID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("sync_%d", time.Now().UnixNano())
	}
	return "sync_" + hex.EncodeToString(b[:])
}
