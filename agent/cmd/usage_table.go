package cmd

import (
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/charmbracelet/x/term"
	"github.com/usejunction/agent/internal/ui"
)

// The terminal tables are drawn with box borders so a row can be followed
// across. Periods are separated by a rule, and the table fits the terminal:
// the flexible column (Models) narrows first and is dropped last.

type usageRowKind int

const (
	usageRowNormal usageRowKind = iota
	// A line under a row that splits it up, such as one model.
	usageRowDetail
	// The total of one period across tools.
	usageRowSubtotal
)

type usageTableRow struct {
	Cells []string
	// GroupStart draws a rule above the row: the first row of a new period.
	GroupStart bool
	Kind       usageRowKind
}

type usageTable struct {
	Header []string
	Rows   []usageTableRow
	// Total is the last line, under a rule. Nil means no total line.
	Total []string
	// The first TextColumns columns are left-aligned; the rest are numbers.
	TextColumns int
	// FlexColumn may narrow, and then be left out, to fit the terminal. -1 for none.
	FlexColumn int
}

const usageFlexColumnMin = 10

// usageTerminalWidth is how wide a table may be: $COLUMNS, else the
// terminal's width, else 0 for no limit (a pipe or a file).
var usageTerminalWidth = func() int {
	if columns, err := strconv.Atoi(strings.TrimSpace(os.Getenv("COLUMNS"))); err == nil && columns > 0 {
		return columns
	}
	if !ui.IsTerminal() {
		return 0
	}
	if width, _, err := term.GetSize(os.Stdout.Fd()); err == nil && width > 0 {
		return width
	}
	return 0
}

func runeWidth(s string) int { return utf8.RuneCountInString(s) }

// render prints the table no wider than maxWidth (0 for no limit), indented one space.
func (t usageTable) render(w io.Writer, maxWidth int) {
	columns := len(t.Header)
	widths := make([]int, columns)
	measure := func(cells []string) {
		for i := 0; i < columns && i < len(cells); i++ {
			if n := runeWidth(cells[i]); n > widths[i] {
				widths[i] = n
			}
		}
	}
	measure(t.Header)
	for _, row := range t.Rows {
		measure(row.Cells)
	}
	if t.Total != nil {
		measure(t.Total)
	}

	// One space of indent, a border per column plus one, and a space each side of every cell.
	tableWidth := func() int {
		total := 1 + 1
		for _, width := range widths {
			if width >= 0 {
				total += width + 3
			}
		}
		return total
	}
	if maxWidth > 0 && t.FlexColumn >= 0 && t.FlexColumn < columns && tableWidth() > maxWidth {
		over := tableWidth() - maxWidth
		if widths[t.FlexColumn]-over >= usageFlexColumnMin {
			widths[t.FlexColumn] -= over
		} else {
			widths[t.FlexColumn] = -1 // left out
			// A row whose only label was in the dropped column (a model under a tool)
			// keeps it in the column to its left, when that cell is empty.
			if left := t.FlexColumn - 1; left >= 0 {
				rows := make([]usageTableRow, len(t.Rows))
				for i, row := range t.Rows {
					rows[i] = row
					if t.FlexColumn < len(row.Cells) && strings.TrimSpace(row.Cells[t.FlexColumn]) != "" && strings.TrimSpace(row.Cells[left]) == "" && row.Kind == usageRowDetail {
						cells := append([]string(nil), row.Cells...)
						cells[left] = cells[t.FlexColumn]
						rows[i].Cells = cells
						// Dropping the column freed room, so the left column may widen into it.
						if n := runeWidth(cells[left]); n > widths[left] {
							widths[left] = n
						}
					}
				}
				t.Rows = rows
				if extra := tableWidth() - maxWidth; extra > 0 {
					widths[left] -= extra
				}
			}
		}
	}

	border := func(left, middle, right string) string {
		var parts []string
		for _, width := range widths {
			if width >= 0 {
				parts = append(parts, strings.Repeat("─", width+2))
			}
		}
		return " " + ui.Muted(left+strings.Join(parts, middle)+right)
	}
	line := func(cells []string, style func(string) string) string {
		var parts []string
		for i, width := range widths {
			if width < 0 {
				continue
			}
			cell := ""
			if i < len(cells) {
				cell = cutToWidth(cells[i], width)
			}
			pad := strings.Repeat(" ", width-runeWidth(cell))
			if i < t.TextColumns {
				cell += pad
			} else {
				cell = pad + cell
			}
			if style != nil && strings.TrimSpace(cell) != "" {
				cell = style(cell)
			}
			parts = append(parts, " "+cell+" ")
		}
		bar := ui.Muted("│")
		return " " + bar + strings.Join(parts, bar) + bar
	}

	fmt.Fprintln(w, border("┌", "┬", "┐"))
	fmt.Fprintln(w, line(t.Header, ui.Muted))
	fmt.Fprintln(w, border("├", "┼", "┤"))
	for i, row := range t.Rows {
		if row.GroupStart && i > 0 {
			fmt.Fprintln(w, border("├", "┼", "┤"))
		}
		var style func(string) string
		switch row.Kind {
		case usageRowDetail:
			style = ui.Muted
		case usageRowSubtotal:
			style = ui.Strong
		}
		fmt.Fprintln(w, line(row.Cells, style))
	}
	if t.Total != nil {
		fmt.Fprintln(w, border("├", "┼", "┤"))
		fmt.Fprintln(w, line(t.Total, ui.Strong))
	}
	fmt.Fprintln(w, border("└", "┴", "┘"))
}

// writeUsageTable prints a plain table: a header, the rows and a total line.
// A column headed "Models" is the one that narrows to fit the terminal.
func writeUsageTable(w io.Writer, table [][]string, total []string, textColumns int) {
	t := usageTable{Header: table[0], Total: total, TextColumns: textColumns, FlexColumn: -1}
	for i, heading := range t.Header {
		if heading == "Models" {
			t.FlexColumn = i
		}
	}
	for _, cells := range table[1:] {
		kind := usageRowNormal
		if len(cells) > 0 && strings.HasPrefix(strings.TrimSpace(strings.Join(cells, "")), "└") {
			kind = usageRowDetail
		}
		t.Rows = append(t.Rows, usageTableRow{Cells: cells, Kind: kind})
	}
	t.render(w, usageTerminalWidth())
}

// shareBar draws share (0 to 1) as a bar of up to width cells, in eighths.
func shareBar(share float64, width int) string {
	if share <= 0 || width <= 0 {
		return ""
	}
	if share > 1 {
		share = 1
	}
	eighths := int(share*float64(width*8) + 0.5)
	if eighths == 0 {
		eighths = 1 // a share too small to see still gets a sliver
	}
	partials := []string{"", "▏", "▎", "▍", "▌", "▋", "▊", "▉"}
	return strings.Repeat("█", eighths/8) + partials[eighths%8]
}

// formatShare shows a share of the total as a whole percent, and "<1%" for a sliver.
func formatShare(share float64) string {
	switch {
	case share <= 0:
		return "0%"
	case share < 0.005:
		return "<1%"
	}
	return fmt.Sprintf("%.0f%%", share*100)
}
