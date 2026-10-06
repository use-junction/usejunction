package workextract

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/usejunction/agent/internal/client"
	"github.com/usejunction/agent/internal/scan"
)

func extractCodex() []client.WorkSession {
	home, _ := os.UserHomeDir()
	codexHome := os.Getenv("CODEX_HOME")
	if codexHome == "" {
		codexHome = filepath.Join(home, ".codex")
	}
	dirs := []string{
		filepath.Join(codexHome, "sessions"),
		filepath.Join(codexHome, "archived_sessions"),
	}

	var out []client.WorkSession
	for _, root := range dirs {
		_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() || !strings.HasSuffix(path, ".jsonl") {
				return nil
			}
			if session, ok := extractCodexFile(path); ok {
				out = append(out, session)
			}
			return nil
		})
	}
	return out
}

type codexWorkState struct {
	id              string
	toolName        string
	model           string
	effort          string
	originator      string
	accountKey      string
	summary         string // prefer last good headline
	repo            *client.RepositoryReport
	toolCounts      map[string]int
	toolOrder       []string
	toolSeen        map[string]bool
	events          []toolEvent
	files           []string
	fileSeen        map[string]bool
	startedAt       time.Time
	endedAt         time.Time
	userTurns       int
	assistantTurns  int
	abortedTurns    int
	firstUser       string
	capturedTurns   []client.WorkTraceUserTurn
	fileChanges     []client.WorkTraceFileChange
	sawEditWrite    bool
	changeNarrative *client.WorkTraceChangeNarrative
}

func extractCodexFile(path string) (client.WorkSession, bool) {
	f, err := os.Open(path)
	if err != nil {
		return client.WorkSession{}, false
	}
	defer f.Close()

	state := &codexWorkState{
		toolName:   "codex",
		toolCounts: map[string]int{},
		toolSeen:   map[string]bool{},
		fileSeen:   map[string]bool{},
	}

	_ = scan.ForEachJSONLLine(f, func(line []byte) error {
		var row map[string]any
		if json.Unmarshal(line, &row) != nil {
			return nil
		}
		applyCodexRow(state, row)
		return nil
	})

	if state.id == "" {
		state.id = basenameID(path)
	}
	if state.model == "" && len(state.toolCounts) == 0 && state.summary == "" {
		return client.WorkSession{}, false
	}
	accountKey := scan.FileAccount(path, state.accountKey, scan.SignedInAccount("codex"))

	meta := map[string]any{}
	if state.originator != "" {
		meta["originator"] = state.originator
	}
	if state.effort != "" {
		meta["effort"] = state.effort
	}

	approach := ""
	if state.effort != "" {
		approach = "effort:" + state.effort
	}
	tools := state.toolOrder
	if len(tools) > 80 {
		tools = tools[:80]
	}
	files := state.files
	if len(files) > 40 {
		files = files[:40]
	}

	var trace *client.WorkTrace
	if approach != "" || len(tools) > 0 || state.repo != nil || len(files) > 0 {
		trace = &client.WorkTrace{
			Approach:        clip(approach, 240),
			Tools:           tools,
			Files:           files,
			DurationSeconds: durationBetween(state.startedAt, state.endedAt),
		}
		if state.repo != nil {
			trace.Location = &client.WorkTraceLocation{
				Kind:       "repo",
				Project:    state.repo.Name,
				Repository: state.repo,
			}
		}
		for _, name := range tools {
			if name == "update_plan" || name == "shell" || name == "apply_patch" || name == "exec" || name == "exec_command" {
				trace.Steps = append(trace.Steps, client.WorkTraceStep{Kind: "tool", Name: name})
			}
			if len(trace.Steps) >= 40 {
				break
			}
		}
		enrichTraceDerived(trace, state.events, files)
	}

	session := client.WorkSession{
		LocalID:        "codex:" + clip(state.id, 120),
		ToolName:       state.toolName,
		AccountKey:     accountKey,
		Model:          clip(state.model, 128),
		Title:          clip(state.summary, 240),
		Tldr:           clip(state.summary, 500),
		StartedAt:      rfc3339OrEmpty(state.startedAt),
		EndedAt:        rfc3339OrEmpty(state.endedAt),
		ObservedAt:     observedFallback(state.endedAt),
		ToolCallCounts: formatToolCounts(state.toolCounts),
		Trace:          trace,
		Repository:     state.repo,
		Source:         clampSource("codex_session"),
		Metadata:       meta,
	}
	if !hasWorkSignal(session) {
		return client.WorkSession{}, false
	}

	toolCalls := 0
	for _, n := range state.toolCounts {
		toolCalls += n
	}
	buildUnderstanding(&session, understandingEvidence{
		DerivedUserTurn: state.firstUser,
		UserTurns:       state.userTurns,
		AssistantTurns:  state.assistantTurns,
		ToolCalls:       toolCalls,
		AbortedTurns:    state.abortedTurns,
		PrimaryFiles:    files,
	})
	if session.Trace == nil {
		session.Trace = &client.WorkTrace{}
	}
	applyThreadCapture(session.Trace, state.capturedTurns, state.fileChanges)
	if state.changeNarrative != nil {
		applyChangeNarrative(session.Trace, state.changeNarrative)
	} else if state.summary != "" {
		if n, ok := captureChangeNarrative(state.summary, state.endedAt, changeNarrativeSourceConversationSummary, false); ok {
			applyChangeNarrative(session.Trace, &n)
		}
	}
	if session.Trace.ChangeNarrative == nil {
		applyChangeNarrative(session.Trace, changeNarrativeFromSessionFallback(session))
	}
	return session, true
}

func applyCodexRow(state *codexWorkState, row map[string]any) {
	ts := parseTimestamp(row["timestamp"])
	if !ts.IsZero() {
		if state.startedAt.IsZero() || ts.Before(state.startedAt) {
			state.startedAt = ts
		}
		if state.endedAt.IsZero() || ts.After(state.endedAt) {
			state.endedAt = ts
		}
	}

	typ, _ := row["type"].(string)
	payload, _ := row["payload"].(map[string]any)
	if payload == nil {
		payload = map[string]any{}
	}

	switch typ {
	case "session_meta":
		if id, _ := payload["id"].(string); id != "" {
			state.id = id
		}
		if originator, _ := payload["originator"].(string); originator != "" {
			state.originator = originator
			state.toolName = codexToolNameFromOriginator(originator)
		}
		if acc := scan.AccountFromRecord(row); acc != "" {
			state.accountKey = acc
		}
		if git, ok := payload["git"].(map[string]any); ok {
			if raw, _ := git["repository_url"].(string); raw != "" {
				state.repo = parseRepoURL(raw)
			}
		}
	case "turn_context":
		if model, _ := payload["model"].(string); model != "" {
			state.model = model
		}
		if effort, _ := payload["effort"].(string); effort != "" {
			state.effort = effort
		}
	case "event_msg":
		payloadType, _ := payload["type"].(string)
		switch payloadType {
		case "user_message":
			state.userTurns++
			if msg, _ := payload["message"].(string); msg != "" {
				ts := parseTimestamp(row["timestamp"])
				if turn, ok := captureUserTurn(msg, ts); ok {
					state.capturedTurns = append(state.capturedTurns, turn)
				}
				if state.firstUser == "" {
					if derived := deriveIntentFromUserTurn(msg); derived != "" {
						state.firstUser = derived
					}
				}
			}
		case "agent_message", "agent_reasoning":
			state.assistantTurns++
			raw := ""
			if text, _ := payload["text"].(string); text != "" {
				raw = text
			} else if msg, _ := payload["message"].(string); msg != "" {
				raw = msg
			}
			if raw != "" {
				// Prefer later reasoning headlines for title quality.
				state.summary = clip(strings.TrimSpace(raw), 240)
				ts := parseTimestamp(row["timestamp"])
				src := changeNarrativeSourceConversationSummary
				require := false
				if payloadType == "agent_message" && state.sawEditWrite {
					src = changeNarrativeSourceAssistantFinal
					require = true
				}
				if n, ok := captureChangeNarrative(raw, ts, src, require); ok {
					state.changeNarrative = preferChangeNarrative(state.changeNarrative, &n)
				} else if !require {
					if n, ok := captureChangeNarrative(raw, ts, changeNarrativeSourceConversationSummary, false); ok {
						state.changeNarrative = preferChangeNarrative(state.changeNarrative, &n)
					}
				}
			}
		case "turn_aborted":
			state.abortedTurns++
		}
	case "response_item":
		payloadType, _ := payload["type"].(string)
		if payloadType == "function_call" || payloadType == "custom_tool_call" {
			if name, _ := payload["name"].(string); name != "" {
				if clean := sanitizeToolName(name); clean != "" {
					mergeToolCounts(state.toolCounts, clean)
					if !state.toolSeen[clean] {
						state.toolSeen[clean] = true
						state.toolOrder = append(state.toolOrder, clean)
					}
					if isEditWriteTool(clean) {
						state.sawEditWrite = true
					}
					ev := toolEvent{Name: clean}
					// Safe peek: basenames / first shell token only — never store args.
					peekCodexToolArgs(state, &ev, clean, payload)
					state.events = append(state.events, ev)
				}
			}
		}
		if payloadType == "message" {
			role, _ := payload["role"].(string)
			switch strings.ToLower(role) {
			case "user":
				state.userTurns++
				// Extract text from content blocks when present — user only.
				if content, ok := payload["content"].([]any); ok {
					var parts []string
					for _, item := range content {
						if m, ok := item.(map[string]any); ok {
							if t, _ := m["text"].(string); strings.TrimSpace(t) != "" {
								parts = append(parts, strings.TrimSpace(t))
							} else if t, _ := m["type"].(string); t == "input_text" {
								if text, _ := m["text"].(string); strings.TrimSpace(text) != "" {
									parts = append(parts, strings.TrimSpace(text))
								}
							}
						} else if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
							parts = append(parts, strings.TrimSpace(s))
						}
					}
					if joined := strings.Join(parts, "\n"); joined != "" {
						ts := parseTimestamp(row["timestamp"])
						if turn, ok := captureUserTurn(joined, ts); ok {
							state.capturedTurns = append(state.capturedTurns, turn)
						}
					}
				}
			case "assistant":
				state.assistantTurns++
			}
		}
		// Prefer short model-provided summaries; never take message/content bodies for title.
		if summary, _ := payload["summary"].(string); summary != "" {
			state.summary = clip(strings.TrimSpace(summary), 240)
			ts := parseTimestamp(row["timestamp"])
			if n, ok := captureChangeNarrative(summary, ts, changeNarrativeSourceConversationSummary, false); ok {
				state.changeNarrative = preferChangeNarrative(state.changeNarrative, &n)
			}
		}
		if summaries, ok := payload["summary"].([]any); ok {
			for _, item := range summaries {
				if m, ok := item.(map[string]any); ok {
					if text, _ := m["text"].(string); text != "" {
						state.summary = clip(strings.TrimSpace(text), 240)
						ts := parseTimestamp(row["timestamp"])
						if n, ok := captureChangeNarrative(text, ts, changeNarrativeSourceConversationSummary, false); ok {
							state.changeNarrative = preferChangeNarrative(state.changeNarrative, &n)
						}
					}
				}
			}
		}
	}
}

func peekCodexToolArgs(state *codexWorkState, ev *toolEvent, name string, payload map[string]any) {
	lower := strings.ToLower(name)
	// arguments may be JSON string (function_call) or input string (custom_tool_call).
	var argMap map[string]any
	if raw, _ := payload["arguments"].(string); raw != "" {
		_ = json.Unmarshal([]byte(raw), &argMap)
	}
	if argMap == nil {
		if inp, ok := payload["input"].(map[string]any); ok {
			argMap = inp
		}
	}
	if argMap == nil {
		if raw, _ := payload["input"].(string); raw != "" {
			if lower == "shell" || lower == "exec" || lower == "exec_command" || lower == "bash" {
				if tok := shellFirstToken(raw); tok != "" {
					ev.ShellToken = tok
				}
			}
			// apply_patch scripts often embed paths as *** Update File: path
			if lower == "apply_patch" || lower == "applypatch" {
				for _, line := range strings.Split(raw, "\n") {
					line = strings.TrimSpace(line)
					for _, prefix := range []string{"*** Update File:", "*** Add File:", "*** Delete File:"} {
						if strings.HasPrefix(line, prefix) {
							base := basenameOnly(strings.TrimSpace(strings.TrimPrefix(line, prefix)))
							if base != "" {
								ev.FileBase = base
								if !state.fileSeen[base] {
									state.fileSeen[base] = true
									state.files = append(state.files, base)
								}
								op := "edit"
								if strings.HasPrefix(line, "*** Add File:") {
									op = "create"
								} else if strings.HasPrefix(line, "*** Delete File:") {
									op = "delete"
								}
								state.capturedTurns, state.fileChanges = recordFileChange(state.capturedTurns, state.fileChanges, client.WorkTraceFileChange{
									File: base, Op: op, Source: "tool", Events: 1,
								})
							}
						}
					}
				}
			}
			return
		}
	}
	if argMap == nil {
		return
	}
	if lower == "shell" || lower == "exec" || lower == "exec_command" || lower == "bash" {
		for _, key := range []string{"command", "cmd", "script"} {
			raw, _ := argMap[key].(string)
			if tok := shellFirstToken(raw); tok != "" {
				ev.ShellToken = tok
				break
			}
		}
	}
	if lower == "apply_patch" || lower == "applypatch" || editTools[lower] || exploreTools[lower] || lower == "read" || lower == "write" {
		for _, key := range []string{"path", "file", "file_path", "filename", "target"} {
			raw, _ := argMap[key].(string)
			base := basenameOnly(raw)
			if base == "" {
				continue
			}
			ev.FileBase = base
			if !state.fileSeen[base] {
				state.fileSeen[base] = true
				state.files = append(state.files, base)
			}
			state.capturedTurns, state.fileChanges = recordToolFileChange(state.capturedTurns, state.fileChanges, name, base)
			break
		}
	}
}

func codexToolNameFromOriginator(originator string) string {
	o := strings.ToLower(strings.TrimSpace(originator))
	if o == "codex_work_desktop" || strings.Contains(o, "codex_work") || strings.HasPrefix(o, "codex-work") {
		return "codex-work"
	}
	return "codex"
}

func sanitizeToolName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 64 {
		return ""
	}
	var b strings.Builder
	b.Grow(len(name))
	for _, r := range name {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '.' || r == ':' || r == '-' {
			b.WriteRune(r)
		} else {
			return ""
		}
	}
	return b.String()
}

func parseTimestamp(v any) time.Time {
	s, _ := v.(string)
	if s == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	}
	return time.Time{}
}
