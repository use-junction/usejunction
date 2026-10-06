package ui

import (
	"bytes"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestEnabledMatrix(t *testing.T) {
	origNoColor := forceNoColor
	origOut := out
	origEnv := os.Getenv("NO_COLOR")
	t.Cleanup(func() {
		forceNoColor = origNoColor
		out = origOut
		if origEnv == "" {
			_ = os.Unsetenv("NO_COLOR")
		} else {
			_ = os.Setenv("NO_COLOR", origEnv)
		}
	})

	t.Run("forceNoColor", func(t *testing.T) {
		_ = os.Unsetenv("NO_COLOR")
		SetNoColor(true)
		SetWriter(os.Stdout)
		if Enabled() {
			t.Fatal("expected disabled when --no-color")
		}
	})

	t.Run("NO_COLOR env", func(t *testing.T) {
		SetNoColor(false)
		_ = os.Setenv("NO_COLOR", "1")
		SetWriter(os.Stdout)
		if Enabled() {
			t.Fatal("expected disabled when NO_COLOR=1")
		}
	})

	t.Run("non-tty writer", func(t *testing.T) {
		SetNoColor(false)
		_ = os.Unsetenv("NO_COLOR")
		var buf bytes.Buffer
		SetWriter(&buf)
		if Enabled() {
			t.Fatal("expected disabled for non-file writer")
		}
	})
}

func TestPlainFallbacks(t *testing.T) {
	origNoColor := forceNoColor
	origOut := out
	t.Cleanup(func() {
		forceNoColor = origNoColor
		out = origOut
	})

	var buf bytes.Buffer
	SetNoColor(true)
	SetWriter(&buf)

	Banner()
	step := StepStart("Enrolling device")
	step.Done("ok")
	ToolLine("cursor", true)
	SuccessBox("http://localhost:3001", "/tmp/.usejunction/bin/usejunction")

	got := buf.String()
	for _, want := range []string{
		"UseJunction",
		"  ✓ Enrolling device  ok",
		"• cursor  ready",
		"✓ UseJunction is set up",
		"Dashboard  http://localhost:3001",
		"Check      usejunction status",
		"Installed  /tmp/.usejunction/bin/usejunction",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("plain output missing %q\n%s", want, got)
		}
	}
	if strings.Contains(got, "\x1b[") {
		t.Fatalf("plain output contained ANSI escapes:\n%s", got)
	}
}

func TestStepUpdatePlainMode(t *testing.T) {
	origNoColor := forceNoColor
	origOut := out
	t.Cleanup(func() {
		forceNoColor = origNoColor
		out = origOut
	})

	var buf bytes.Buffer
	SetNoColor(true)
	SetWriter(&buf)

	step := StepStart("Uploading initial usage")
	step.Update("Scanning cursor")
	step.Update("Scanning cursor") // duplicate should not repeat
	step.Update("Syncing usage (934 rows)")
	step.Done("6 tools · 934 usage rows")

	got := buf.String()
	for _, want := range []string{
		"  … Uploading initial usage\n",
		"· Scanning cursor",
		"· Syncing usage (934 rows)",
		"  ✓ Uploading initial usage  6 tools · 934 usage rows · 0s",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("plain progress missing %q\n%s", want, got)
		}
	}
	if strings.Count(got, "Scanning cursor") != 1 {
		t.Fatalf("duplicate progress lines should be suppressed:\n%s", got)
	}
}

func TestScanPanelPlainMode(t *testing.T) {
	origNoColor := forceNoColor
	origOut := out
	t.Cleanup(func() {
		forceNoColor = origNoColor
		out = origOut
	})

	var buf bytes.Buffer
	SetNoColor(true)
	SetWriter(&buf)

	panel := ScanPanelStart("Uploading initial usage", []string{"cursor", "claude", "codex"})
	panel.ToolStart("cursor")
	panel.ToolFinish("cursor", false)
	panel.ToolStart("claude")
	panel.ToolFinish("claude", true)
	panel.Update("Syncing usage (12 rows)")
	panel.Update("Syncing usage (12 rows)")
	panel.Done("3 tools · 12 usage rows")

	got := buf.String()
	want := "  … Uploading initial usage\n" +
		"      ✓ cursor\n" +
		"      – claude skipped\n" +
		"      · Syncing usage (12 rows)\n" +
		"  ✓ Uploading initial usage  3 tools · 12 usage rows · 0s\n"
	if got != want {
		t.Fatalf("plain scan panel should show the label, each tool, progress, and a summary:\n%s", got)
	}
}

func TestStepDoneDoesNotDeadlockWithSpinner(t *testing.T) {
	origOut := out
	t.Cleanup(func() { out = origOut })

	var buf bytes.Buffer
	SetWriter(&buf)

	s := &Step{
		label:  "Uploading initial usage",
		stop:   make(chan struct{}),
		done:   make(chan struct{}),
		active: true,
	}
	go s.spin()

	finished := make(chan struct{})
	go func() {
		for i := 0; i < 100; i++ {
			s.Update(fmt.Sprintf("progress %d", i))
			time.Sleep(time.Millisecond)
		}
	}()

	go func() {
		time.Sleep(5 * time.Millisecond)
		s.Done("6 tools · 926 usage rows")
		close(finished)
	}()

	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("Done() deadlocked with spinner goroutine")
	}
}

func TestScanPanelDoneDoesNotDeadlock(t *testing.T) {
	origOut := out
	t.Cleanup(func() { out = origOut })

	var buf bytes.Buffer
	SetWriter(&buf)

	p := &ScanPanel{
		label:     "Uploading initial usage",
		toolOrder: []string{"cursor", "claude"},
		status: map[string]ToolScanStatus{
			"cursor": ToolPending,
			"claude": ToolPending,
		},
		stop:   make(chan struct{}),
		done:   make(chan struct{}),
		active: true,
	}
	go p.spin()

	finished := make(chan struct{})
	go func() {
		p.ToolStart("cursor")
		p.ToolFinish("cursor", false)
		p.ToolStart("claude")
		p.Update("Syncing usage")
		time.Sleep(5 * time.Millisecond)
		p.Done("2 tools")
		close(finished)
	}()

	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("ScanPanel.Done() deadlocked with spinner goroutine")
	}
}

func TestPlainQuickStepPrintsOneLine(t *testing.T) {
	origNoColor, origOut := forceNoColor, out
	t.Cleanup(func() { forceNoColor, out = origNoColor, origOut })
	var buf bytes.Buffer
	SetNoColor(true)
	SetWriter(&buf)

	StepStart("Enrolling device").Done("MacBook-Pro · cms22foy")
	if got := buf.String(); got != "  ✓ Enrolling device  MacBook-Pro · cms22foy\n" {
		t.Fatalf("quick plain step should be one line, got:\n%s", got)
	}
}

func TestPlainSlowStepAnnouncesAndKeepsAHeartbeat(t *testing.T) {
	origNoColor, origOut := forceNoColor, out
	origAnnounce, origBeat := plainAnnounceAfter, plainHeartbeat
	t.Cleanup(func() {
		forceNoColor, out = origNoColor, origOut
		plainAnnounceAfter, plainHeartbeat = origAnnounce, origBeat
	})
	var buf syncBuffer
	SetNoColor(true)
	SetWriter(&buf)
	plainAnnounceAfter, plainHeartbeat = 10*time.Millisecond, 20*time.Millisecond

	step := StepStart("Uploading initial usage")
	time.Sleep(70 * time.Millisecond)
	step.Done("6 tools")
	got := buf.String()
	for _, want := range []string{"  … Uploading initial usage\n", "… still working · ", "  ✓ Uploading initial usage  6 tools · "} {
		if !strings.Contains(got, want) {
			t.Fatalf("slow plain step missing %q:\n%s", want, got)
		}
	}
	after := buf.String()
	time.Sleep(50 * time.Millisecond)
	if buf.String() != after {
		t.Fatalf("heartbeat kept printing after the step finished:\n%s", buf.String())
	}
}

type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func TestScanPanelHidesToolsThatAreNotInstalled(t *testing.T) {
	origNoColor, origOut := forceNoColor, out
	t.Cleanup(func() { forceNoColor, out = origNoColor, origOut })
	var buf bytes.Buffer
	SetNoColor(true)
	SetWriter(&buf)

	panel := ScanPanelStart("Uploading initial usage", []string{"cursor", "roo", "ollama"})
	panel.ToolFinish("cursor", false)
	panel.ToolAbsent("roo")
	panel.ToolAbsent("ollama")
	panel.Done("1 tool")
	got := buf.String()
	if strings.Contains(got, "roo") || strings.Contains(got, "ollama") {
		t.Fatalf("tools that are not installed must not be listed:\n%s", got)
	}
	if !strings.Contains(got, "✓ cursor") {
		t.Fatalf("installed tool missing:\n%s", got)
	}

	p := &ScanPanel{label: "Uploading", toolOrder: []string{"cursor", "roo"}, status: map[string]ToolScanStatus{"cursor": ToolDone, "roo": ToolAbsent}}
	lines := strings.Join(p.renderLines("·"), "\n")
	if strings.Contains(lines, "roo") || !strings.Contains(lines, "checked 2 of 2 tools") {
		t.Fatalf("live panel should hide absent tools and count checks:\n%s", lines)
	}
}
