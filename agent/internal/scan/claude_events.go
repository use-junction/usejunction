package scan

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// UsageEvent is one priced model response read from a Claude Code session log.
// The daily scan folds these into per-day totals for upload; the session and
// block reports need them one by one. Events are only ever shown in the
// terminal: nothing here is uploaded.
type UsageEvent struct {
	Time      time.Time
	SessionID string
	// Project is the name of the folder the session ran in.
	Project    string
	Model      string
	Input      int
	Output     int
	CacheRead  int
	CacheWrite int
	Cost       float64
}

// claudeEventLine holds the few fields of a session line an event is made of.
// Prompt and response text are never decoded.
type claudeEventLine struct {
	Type      string `json:"type"`
	Timestamp string `json:"timestamp"`
	SessionID string `json:"sessionId"`
	RequestID string `json:"requestId"`
	Cwd       string `json:"cwd"`
	Message   struct {
		ID    string `json:"id"`
		Model string `json:"model"`
		Usage *struct {
			Input      int `json:"input_tokens"`
			Output     int `json:"output_tokens"`
			CacheRead  int `json:"cache_read_input_tokens"`
			CacheWrite int `json:"cache_creation_input_tokens"`
		} `json:"usage"`
	} `json:"message"`
}

var (
	claudeAssistantMarker = []byte(`"assistant"`)
	claudeUsageMarker     = []byte(`"usage"`)
)

type keyedUsageEvent struct {
	event UsageEvent
	key   string
	// byResponse is true when key names the response itself (request and
	// message id) rather than a fingerprint of its numbers.
	byResponse bool
}

// ScanClaudeEvents reads every usage event from session files changed at or
// after modifiedSince, oldest first. A file untouched since then cannot hold a
// newer event, so it is skipped without being opened. Events older than
// modifiedSince can still come back from a file that was changed later; the
// caller filters by Time.
func ScanClaudeEvents(roots []string, modifiedSince time.Time) []UsageEvent {
	var files []string
	seenFile := map[string]bool{}
	for _, root := range roots {
		_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() || !strings.HasSuffix(path, ".jsonl") {
				return nil
			}
			if info.ModTime().Before(modifiedSince) {
				return nil
			}
			// The same folder is often listed twice (~/.claude and CLAUDE_CONFIG_DIR).
			if resolved, rerr := filepath.EvalSymlinks(path); rerr == nil {
				path = resolved
			}
			if !seenFile[path] {
				seenFile[path] = true
				files = append(files, path)
			}
			return nil
		})
	}
	sort.Strings(files)

	perFile := make([][]keyedUsageEvent, len(files))
	workers := runtime.NumCPU()
	if workers > 8 {
		workers = 8
	}
	var wg sync.WaitGroup
	next := make(chan int)
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range next {
				perFile[i] = readClaudeEventFile(files[i])
			}
		}()
	}
	for i := range files {
		next <- i
	}
	close(next)
	wg.Wait()

	// The same response can be written to more than one file (a resumed
	// session copies its history), so duplicates are dropped across files.
	// One response can also be logged over several lines, the early ones with
	// a partial output count; the most complete line is the one kept.
	position := map[string]int{}
	var events []UsageEvent
	for _, fileEvents := range perFile {
		for _, keyed := range fileEvents {
			if keyed.key == "" {
				events = append(events, keyed.event)
				continue
			}
			at, counted := position[keyed.key]
			if !counted {
				position[keyed.key] = len(events)
				events = append(events, keyed.event)
				continue
			}
			if keyed.byResponse && keyed.event.Output > events[at].Output {
				events[at] = keyed.event
			}
		}
	}
	sort.SliceStable(events, func(i, j int) bool { return events[i].Time.Before(events[j].Time) })
	return events
}

func readClaudeEventFile(path string) []keyedUsageEvent {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	// A session folder is named after its working directory with the slashes
	// turned into dashes; the last part stands in when a line has no cwd.
	fallbackProject := claudeProjectFromLogPath(path)
	fallbackSession := strings.TrimSuffix(filepath.Base(path), ".jsonl")

	var events []keyedUsageEvent
	_ = ForEachJSONLLine(f, func(line []byte) error {
		if !bytes.Contains(line, claudeUsageMarker) || !bytes.Contains(line, claudeAssistantMarker) {
			return nil
		}
		var row claudeEventLine
		if json.Unmarshal(line, &row) != nil || row.Type != "assistant" || row.Message.Usage == nil {
			return nil
		}
		usage := row.Message.Usage
		// Matches the daily scan, which skips lines with no input or output.
		if usage.Input+usage.Output == 0 {
			return nil
		}
		at, perr := time.Parse(time.RFC3339, row.Timestamp)
		if perr != nil {
			return nil
		}
		event := UsageEvent{
			Time: at, SessionID: row.SessionID, Model: row.Message.Model,
			Input: usage.Input, Output: usage.Output, CacheRead: usage.CacheRead, CacheWrite: usage.CacheWrite,
		}
		if event.SessionID == "" {
			event.SessionID = fallbackSession
		}
		event.Project = fallbackProject
		if cwd := strings.TrimSpace(row.Cwd); cwd != "" {
			event.Project = filepath.Base(cwd)
		}
		event.Cost = EstimateCostForTool("claude", event.Model, event.Input, event.Output, event.CacheRead, event.CacheWrite)
		keyed := keyedUsageEvent{event: event, key: usageResponseKey(row.RequestID, row.Message.ID), byResponse: true}
		if keyed.key == "" {
			keyed.byResponse = false
			keyed.key = usageDedupeKey(row.RequestID, row.Message.ID, at.Format("2006-01-02"), event.Model, event.Input, event.Output, event.CacheRead)
		}
		events = append(events, keyed)
		return nil
	})
	return events
}

// usageResponseKey names one model response by its request and message id.
// It is empty when a line lacks either, and usageDedupeKey stands in. The
// daily scan and the event scan share both, so their totals agree.
func usageResponseKey(requestID, messageID string) string {
	if requestID == "" || messageID == "" {
		return ""
	}
	return requestID + "|" + messageID
}

// usageDedupeKey fingerprints a line that has no ids by its numbers, so the
// same line written twice is counted once. An empty result means the line
// carries nothing to tell it apart by.
func usageDedupeKey(requestID, messageID, date, model string, input, output, cacheRead int) string {
	key := requestID + messageID + date + model + "|" +
		strconv.Itoa(input) + "|" + strconv.Itoa(output) + "|" + strconv.Itoa(cacheRead)
	if key == "|||" {
		return ""
	}
	return key
}

func claudeProjectFromLogPath(path string) string {
	dir := filepath.Dir(path)
	for {
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		if filepath.Base(parent) == "projects" {
			break
		}
		dir = parent
	}
	name := filepath.Base(dir)
	if i := strings.LastIndex(name, "-"); i >= 0 && i < len(name)-1 {
		return name[i+1:]
	}
	return name
}
