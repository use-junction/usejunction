// Package ui provides branded terminal presentation for the UseJunction CLI.
// When stdout is not a TTY, or NO_COLOR / --no-color is set, helpers fall back
// to plain text with no ANSI and no animation.
package ui

import (
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/lipgloss"
	"github.com/mattn/go-isatty"
	"github.com/usejunction/agent/internal/types"
)

// Brand colors from apps/admin/app/globals.css.
const (
	colorTeal   = "#08758a"
	colorYellow = "#e5ec67"
	colorOrange = "#c0682c"
	colorOlive  = "#202419"
	colorMuted  = "#6b7260"
	colorOk     = "#98ac26"
)

var (
	forceNoColor bool
	out          io.Writer = os.Stdout
	// writeMu serializes animated writes so concurrent steps cannot garble the TTY.
	writeMu sync.Mutex
)

// SetNoColor disables color and animation (wired from --no-color).
func SetNoColor(v bool) {
	forceNoColor = v
}

// SetWriter overrides the output writer (tests).
func SetWriter(w io.Writer) {
	if w == nil {
		out = os.Stdout
		return
	}
	out = w
}

// Enabled reports whether styled/animated output should be used.
func Enabled() bool {
	if forceNoColor {
		return false
	}
	if os.Getenv("NO_COLOR") != "" {
		return false
	}
	f, ok := out.(*os.File)
	if !ok {
		return false
	}
	return isatty.IsTerminal(f.Fd()) || isatty.IsCygwinTerminal(f.Fd())
}

func styleTeal() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(lipgloss.Color(colorTeal)).Bold(true)
}

func styleYellow() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(lipgloss.Color(colorYellow)).Bold(true)
}

func styleMuted() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(lipgloss.AdaptiveColor{
		Light: colorMuted,
		Dark:  "#9aa18c",
	})
}

func styleOk() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(lipgloss.Color(colorOk)).Bold(true)
}

func styleWarn() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(lipgloss.Color(colorOrange)).Bold(true)
}

func styleFail() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(lipgloss.Color(colorOrange)).Bold(true)
}

func styleBody() lipgloss.Style {
	// Olive reads as near-black on dark terminals; adapt for dark/light.
	return lipgloss.NewStyle().Foreground(lipgloss.AdaptiveColor{
		Light: colorOlive,
		Dark:  "#e6e8df",
	})
}

// Banner prints the UseJunction wordmark.
func Banner() {
	if !Enabled() {
		fmt.Fprintln(out, "UseJunction")
		fmt.Fprintln(out)
		return
	}
	mark := styleYellow().Render("◆")
	name := styleTeal().Render("UseJunction")
	fmt.Fprintf(out, "\n  %s  %s\n\n", mark, name)
}

// Step is an in-flight progress step with an optional spinner.
type Step struct {
	label  string
	stop   chan struct{}
	done   chan struct{}
	mu     sync.Mutex
	active bool
	detail string
	plain  *plainProgress
}

// StepStart begins a progress step. Call Done or Fail when finished.
func StepStart(label string) *Step {
	s := &Step{label: label}
	if !Enabled() {
		// Plain output has no spinner to overwrite: quick steps print once when they
		// finish; slow ones announce themselves and keep a heartbeat going.
		s.plain = startPlainProgress(label)
		return s
	}
	s.stop = make(chan struct{})
	s.done = make(chan struct{})
	s.active = true
	go s.spin()
	return s
}

// Update sets live detail shown beside the spinner (e.g. current sub-phase).
func (s *Step) Update(detail string) {
	detail = strings.TrimSpace(detail)
	if detail == "" {
		return
	}
	s.mu.Lock()
	if detail == s.detail {
		s.mu.Unlock()
		return
	}
	s.detail = detail
	s.mu.Unlock()
	if s.plain != nil {
		s.plain.line("      · " + detail)
	}
}

func (s *Step) renderLine() string {
	s.mu.Lock()
	detail := s.detail
	label := s.label
	s.mu.Unlock()
	line := styleBody().Render(label)
	if detail != "" {
		line += styleMuted().Render("  · " + detail)
	}
	return line
}

func (s *Step) spin() {
	defer close(s.done)
	frames := spinner.MiniDot.Frames
	fps := spinner.MiniDot.FPS
	if fps <= 0 {
		fps = time.Second / 12
	}
	i := 0
	spinStyle := styleTeal()
	ticker := time.NewTicker(fps)
	defer ticker.Stop()
	for {
		frame := spinStyle.Render(strings.TrimSpace(frames[i%len(frames)]))
		writeMu.Lock()
		fmt.Fprintf(out, "\r\033[2K  %s  %s", frame, s.renderLine())
		writeMu.Unlock()
		i++
		select {
		case <-s.stop:
			return
		case <-ticker.C:
		}
	}
}

// Done finishes the step successfully.
func (s *Step) Done(detail string) {
	s.finish(true, detail)
}

// Fail finishes the step with an error style.
func (s *Step) Fail(detail string) {
	s.finish(false, detail)
}

func (s *Step) finish(ok bool, detail string) {
	s.mu.Lock()
	waitDone := s.stop != nil && s.active
	if waitDone {
		close(s.stop)
		s.active = false
	}
	s.mu.Unlock()
	if waitDone {
		<-s.done
		writeMu.Lock()
		fmt.Fprintf(out, "\r\033[2K")
		writeMu.Unlock()
	}
	if !Enabled() {
		fmt.Fprintln(out, plainResult(ok, s.label, s.plain.finish(detail)))
		return
	}
	mark := styleOk().Render("✓")
	if !ok {
		mark = styleFail().Render("✗")
	}
	line := fmt.Sprintf("  %s  %s", mark, styleBody().Render(s.label))
	if detail != "" {
		line += styleMuted().Render("  "+detail)
	}
	writeMu.Lock()
	fmt.Fprintln(out, line)
	writeMu.Unlock()
}

// ToolScanStatus is the live state of one tool row in a ScanPanel.
type ToolScanStatus int

const (
	ToolPending ToolScanStatus = iota
	ToolScanning
	ToolDone
	ToolSkipped
	// ToolAbsent: checked and not installed. Hidden, so only real tools are listed.
	ToolAbsent
)

// ScanPanel is a live multi-line progress block: parent label + one row per tool.
type ScanPanel struct {
	label     string
	toolOrder []string
	status    map[string]ToolScanStatus
	detail    string
	stop      chan struct{}
	done      chan struct{}
	mu        sync.Mutex
	active    bool
	lines     int
	plain     *plainProgress
}

// ScanPanelStart begins a multi-line scan panel. toolIDs are shown as pending rows.
func ScanPanelStart(label string, toolIDs []string) *ScanPanel {
	status := make(map[string]ToolScanStatus, len(toolIDs))
	order := make([]string, 0, len(toolIDs))
	seen := make(map[string]struct{}, len(toolIDs))
	for _, id := range toolIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		order = append(order, id)
		status[id] = ToolPending
	}
	p := &ScanPanel{
		label:     label,
		toolOrder: order,
		status:    status,
	}
	if !Enabled() {
		// Plain output is read top to bottom: the label, one line per tool, a summary.
		p.plain = startPlainProgress(label)
		return p
	}
	p.stop = make(chan struct{})
	p.done = make(chan struct{})
	p.active = true
	go p.spin()
	return p
}

// ToolStart marks a tool as actively scanning.
func (p *ScanPanel) ToolStart(id string) {
	p.setTool(id, ToolScanning)
}

// ToolAbsent marks a tool as checked but not installed on this machine.
func (p *ScanPanel) ToolAbsent(id string) {
	p.setTool(id, ToolAbsent)
}

// ToolFinish marks a tool as finished (or skipped on timeout).
func (p *ScanPanel) ToolFinish(id string, skipped bool) {
	if skipped {
		p.setTool(id, ToolSkipped)
		return
	}
	p.setTool(id, ToolDone)
}

func (p *ScanPanel) setTool(id string, st ToolScanStatus) {
	id = strings.TrimSpace(id)
	if id == "" {
		return
	}
	p.mu.Lock()
	if _, ok := p.status[id]; !ok {
		p.toolOrder = append(p.toolOrder, id)
	}
	p.status[id] = st
	p.mu.Unlock()
	if p.plain != nil {
		switch st {
		case ToolDone:
			p.plain.line(fmt.Sprintf("      ✓ %s", id))
		case ToolSkipped:
			p.plain.line(fmt.Sprintf("      – %s skipped", id))
		}
	}
}

// Update sets a secondary detail line (upload / sync phase after tools).
func (p *ScanPanel) Update(detail string) {
	detail = strings.TrimSpace(detail)
	if detail == "" {
		return
	}
	p.mu.Lock()
	if detail == p.detail {
		p.mu.Unlock()
		return
	}
	p.detail = detail
	p.mu.Unlock()
	if p.plain != nil {
		p.plain.line("      · " + detail)
	}
}

func (p *ScanPanel) spin() {
	defer close(p.done)
	frames := spinner.MiniDot.Frames
	fps := spinner.MiniDot.FPS
	if fps <= 0 {
		fps = time.Second / 12
	}
	i := 0
	spinStyle := styleTeal()
	ticker := time.NewTicker(fps)
	defer ticker.Stop()
	for {
		frame := spinStyle.Render(strings.TrimSpace(frames[i%len(frames)]))
		p.redraw(frame)
		i++
		select {
		case <-p.stop:
			return
		case <-ticker.C:
		}
	}
}

func (p *ScanPanel) redraw(frame string) {
	lines := p.renderLines(frame)
	writeMu.Lock()
	defer writeMu.Unlock()
	if p.lines > 0 {
		fmt.Fprintf(out, "\033[%dA", p.lines)
	}
	for _, line := range lines {
		fmt.Fprintf(out, "\r\033[2K%s\n", line)
	}
	p.lines = len(lines)
}

func (p *ScanPanel) renderLines(frame string) []string {
	p.mu.Lock()
	defer p.mu.Unlock()

	lines := make([]string, 0, 2+len(p.toolOrder))
	lines = append(lines, fmt.Sprintf("  %s  %s", frame, styleBody().Render(p.label)))

	pendingMark := styleMuted().Render("○")
	doneMark := styleOk().Render("✓")
	skipMark := styleMuted().Render("–")

	checked := 0
	for _, id := range p.toolOrder {
		if st := p.status[id]; st == ToolDone || st == ToolSkipped || st == ToolAbsent {
			checked++
		}
	}
	lines[0] += styleMuted().Render(fmt.Sprintf("  · checked %d of %d tools", checked, len(p.toolOrder)))
	for _, id := range p.toolOrder {
		var mark string
		var name string
		switch p.status[id] {
		case ToolAbsent, ToolPending:
			continue
		case ToolScanning:
			mark = frame
			name = styleBody().Render(id)
		case ToolDone:
			mark = doneMark
			name = styleBody().Render(id)
		case ToolSkipped:
			mark = skipMark
			name = styleMuted().Render(id + " skipped")
		default:
			mark = pendingMark
			name = styleMuted().Render(id)
		}
		lines = append(lines, fmt.Sprintf("      %s  %s", mark, name))
	}
	if p.detail != "" {
		lines = append(lines, fmt.Sprintf("      %s", styleMuted().Render("· "+p.detail)))
	}
	return lines
}

// Done finishes the panel successfully and collapses to a single summary line.
func (p *ScanPanel) Done(detail string) {
	p.finish(true, detail)
}

// Fail finishes the panel with an error style.
func (p *ScanPanel) Fail(detail string) {
	p.finish(false, detail)
}

func (p *ScanPanel) finish(ok bool, detail string) {
	p.mu.Lock()
	waitDone := p.stop != nil && p.active
	if waitDone {
		close(p.stop)
		p.active = false
	}
	p.mu.Unlock()
	if waitDone {
		<-p.done
		writeMu.Lock()
		lines := p.lines
		if lines > 0 {
			fmt.Fprintf(out, "\033[%dA", lines)
			for i := 0; i < lines; i++ {
				fmt.Fprintf(out, "\r\033[2K")
				if i+1 < lines {
					fmt.Fprint(out, "\n")
				}
			}
			if lines > 1 {
				fmt.Fprintf(out, "\033[%dA", lines-1)
			}
			fmt.Fprintf(out, "\r\033[2K")
		}
		p.lines = 0
		writeMu.Unlock()
	}
	if !Enabled() {
		fmt.Fprintln(out, plainResult(ok, p.label, p.plain.finish(detail)))
		return
	}
	mark := styleOk().Render("✓")
	if !ok {
		mark = styleFail().Render("✗")
	}
	line := fmt.Sprintf("  %s  %s", mark, styleBody().Render(p.label))
	if detail != "" {
		line += styleMuted().Render("  "+detail)
	}
	writeMu.Lock()
	fmt.Fprintln(out, line)
	writeMu.Unlock()
}

// plainResult is the single uncoloured line a finished step prints, e.g. "  ✓ Enrolling device  MacBook-Pro".
func plainResult(ok bool, label, detail string) string {
	mark := "✓"
	if !ok {
		mark = "✗"
	}
	line := fmt.Sprintf("  %s %s", mark, label)
	if detail != "" {
		line += "  " + detail
	}
	return line
}

// Plain-mode pacing: announce a step that runs longer than plainAnnounceAfter,
// then print a heartbeat every plainHeartbeat so piped installs never go silent.
var (
	plainAnnounceAfter = 1200 * time.Millisecond
	plainHeartbeat     = 15 * time.Second
)

type plainProgress struct {
	label     string
	started   time.Time
	after     time.Duration
	beat      time.Duration
	stop      chan struct{}
	mu        sync.Mutex
	announced bool
	finished  bool
}

func startPlainProgress(label string) *plainProgress {
	p := &plainProgress{label: label, started: time.Now(), after: plainAnnounceAfter, beat: plainHeartbeat, stop: make(chan struct{})}
	go p.run()
	return p
}

func (p *plainProgress) run() {
	timer := time.NewTimer(p.after)
	defer timer.Stop()
	select {
	case <-p.stop:
		return
	case <-timer.C:
	}
	p.announce()
	ticker := time.NewTicker(p.beat)
	defer ticker.Stop()
	for {
		select {
		case <-p.stop:
			return
		case <-ticker.C:
			p.mu.Lock()
			finished := p.finished
			p.mu.Unlock()
			if finished {
				return
			}
			writeMu.Lock()
			fmt.Fprintf(out, "      … still working · %s\n", elapsedLabel(time.Since(p.started)))
			writeMu.Unlock()
		}
	}
}

// announce prints the "working on it" line once, before any detail lines.
func (p *plainProgress) announce() {
	p.mu.Lock()
	if p.announced || p.finished {
		p.mu.Unlock()
		return
	}
	p.announced = true
	p.mu.Unlock()
	writeMu.Lock()
	fmt.Fprintf(out, "  … %s\n", p.label)
	writeMu.Unlock()
}

func (p *plainProgress) line(text string) {
	p.announce()
	writeMu.Lock()
	fmt.Fprintln(out, text)
	writeMu.Unlock()
}

// finish stops the heartbeat and returns the detail for the result line, with
// the elapsed time added when the step was slow enough to be announced.
func (p *plainProgress) finish(detail string) string {
	if p == nil {
		return detail
	}
	p.mu.Lock()
	announced := p.announced
	if !p.finished {
		p.finished = true
		close(p.stop)
	}
	p.mu.Unlock()
	if !announced {
		return detail
	}
	took := elapsedLabel(time.Since(p.started))
	if detail == "" {
		return took
	}
	return detail + " · " + took
}

func elapsedLabel(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Round(time.Second).Seconds()))
	}
	return fmt.Sprintf("%dm %02ds", int(d.Minutes()), int(d.Seconds())%60)
}

// QuietLine prints a muted secondary line under a step.
func QuietLine(msg string) {
	if !Enabled() {
		fmt.Fprintf(out, "      %s\n", msg)
		return
	}
	fmt.Fprintf(out, "      %s\n", styleMuted().Render(msg))
}

// WarnLine prints an orange warning.
func WarnLine(msg string) {
	if !Enabled() {
		fmt.Fprintf(out, "warning: %s\n", msg)
		return
	}
	fmt.Fprintf(out, "  %s  %s\n", styleWarn().Render("!"), styleBody().Render(msg))
}

// ToolLine prints one detected tool.
func ToolLine(name string, ready bool) {
	tag := ""
	if ready {
		tag = " [ready]"
	}
	if !Enabled() {
		fmt.Fprintf(out, "      • %s%s\n", name, strings.Replace(tag, " [ready]", "  ready", 1))
		return
	}
	mark := styleOk().Render("✓")
	if !ready {
		mark = styleMuted().Render("○")
	}
	line := fmt.Sprintf("  %s  %s", mark, styleBody().Render(name))
	if ready {
		line += styleTeal().Render(tag)
	}
	fmt.Fprintln(out, line)
}

// ToolReveal prints one detected tool with a short delay for staged onboarding reveal.
func ToolReveal(name string, ready bool) {
	ToolLine(name, ready)
	if Enabled() {
		time.Sleep(45 * time.Millisecond)
	}
}

// StatusSummary prints enrollment fields without the tool list.
func StatusSummary(deviceID, orgID, version string, toolCount int) {
	if !Enabled() {
		fmt.Fprintf(out, "Status:       enrolled\n")
		fmt.Fprintf(out, "Device ID:    %s\n", deviceID)
		fmt.Fprintf(out, "Org ID:       %s\n", orgID)
		fmt.Fprintf(out, "Agent:        v%s\n", version)
		fmt.Fprintf(out, "Tools found:  %d\n", toolCount)
		return
	}

	fmt.Fprintln(out)
	header := styleTeal().Render("Status")
	fmt.Fprintf(out, "  %s  %s\n", header, styleOk().Render("enrolled"))
	kv := func(k, v string) {
		fmt.Fprintf(out, "  %s  %s\n", styleMuted().Render(padRight(k, 10)), styleBody().Render(v))
	}
	kv("Device", deviceID)
	kv("Org", orgID)
	kv("Agent", "v"+version)
	kv("Tools", fmt.Sprintf("%d detected", toolCount))
}

// StatusCard prints enrollment summary including detected tools.
func StatusCard(deviceID, orgID, version string, tools []types.ToolStatus) {
	StatusSummary(deviceID, orgID, version, len(tools))
	if !Enabled() {
		for _, t := range tools {
			tag := ""
			if t.Configured {
				tag = " [ready]"
			}
			fmt.Fprintf(out, "  • %s%s\n", t.ToolName, tag)
		}
		return
	}
	fmt.Fprintln(out)
	for _, t := range tools {
		ToolLine(t.ToolName, t.Configured)
	}
}

// DoctorTable prints the tool detection table.
func DoctorTable(detected []types.ToolStatus) {
	if !Enabled() {
		fmt.Fprintf(out, "%-14s  %-10s  %-14s  %s\n", "TOOL", "DETECTED", "CONFIGURED", "CONFIG PATH")
		fmt.Fprintf(out, "%-14s  %-10s  %-14s  %s\n", "----", "--------", "----------", "-----------")
		for _, r := range detected {
			configured := "no"
			if r.Configured {
				configured = "yes"
			}
			fmt.Fprintf(out, "%-14s  %-10s  %-14s  %s\n", r.ToolName, "yes", configured, r.ConfigPath)
		}
		fmt.Fprintf(out, "\n%d tool(s) detected.\n", len(detected))
		return
	}

	headerStyle := styleMuted().Bold(true)
	yes := styleOk().Render("yes")
	no := styleMuted().Render("no")

	fmt.Fprintf(out, "  %s  %s  %s  %s\n",
		headerStyle.Render(padRight("TOOL", 14)),
		headerStyle.Render(padRight("DETECTED", 10)),
		headerStyle.Render(padRight("CONFIGURED", 10)),
		headerStyle.Render("CONFIG PATH"),
	)
	for _, r := range detected {
		cfg := no
		if r.Configured {
			cfg = yes
		}
		fmt.Fprintf(out, "  %s  %s  %s  %s\n",
			styleBody().Render(padRight(r.ToolName, 14)),
			yes+"       ",
			padRightVisible(cfg, 10),
			styleMuted().Render(r.ConfigPath),
		)
	}
	fmt.Fprintf(out, "\n  %s\n", styleTeal().Render(fmt.Sprintf("%d tool(s) detected.", len(detected))))
}

// SuccessBox prints the post-install closing lines (no bordered panel).
func SuccessBox(adminURL, cliPath string) {
	fmt.Fprintln(out)
	if !Enabled() {
		fmt.Fprintf(out, "  ✓ UseJunction is set up\n")
		fmt.Fprintf(out, "      Dashboard  %s\n", adminURL)
		fmt.Fprintf(out, "      Check      usejunction status   (in a new terminal)\n")
		fmt.Fprintf(out, "      Installed  %s\n\n", tildePath(cliPath))
		return
	}

	fmt.Fprintf(out, "  %s  %s\n", styleYellow().Render("◆"), styleTeal().Render("UseJunction is set up"))
	fmt.Fprintf(out, "      %s  %s\n", styleMuted().Render(padRight("Dashboard", 9)), styleBody().Render(adminURL))
	fmt.Fprintf(out, "      %s  %s%s\n", styleMuted().Render(padRight("Check", 9)), styleBody().Render("usejunction status"), styleMuted().Render("   (in a new terminal)"))
	fmt.Fprintf(out, "      %s  %s\n\n", styleMuted().Render(padRight("Installed", 9)), styleMuted().Render(tildePath(cliPath)))
}

// tildePath shortens a path under the home directory to ~/…
func tildePath(path string) string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" || !strings.HasPrefix(path, home) {
		return path
	}
	return "~" + strings.TrimPrefix(path, home)
}

func padRight(s string, n int) string {
	if len(s) >= n {
		return s
	}
	return s + strings.Repeat(" ", n-len(s))
}

func padRightVisible(styled string, n int) string {
	visible := lipgloss.Width(styled)
	if visible >= n {
		return styled
	}
	return styled + strings.Repeat(" ", n-visible)
}

func dirOf(cliPath string) string {
	i := strings.LastIndexAny(cliPath, "/\\")
	if i < 0 {
		return cliPath
	}
	return cliPath[:i]
}
