package ui

import (
	"fmt"
	"io"
	"sort"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// PickerAccount is one provider login offered in the account picker.
type PickerAccount struct {
	ID       string // opaque caller key, returned in the selection
	Email    string
	Provider string // display name, e.g. "Cursor"
	Plan     string
	Selected bool
	Locked   bool // an admin lock prevents the developer from changing it
}

// PickerGroup is every login for one provider (e.g. all ChatGPT accounts).
type PickerGroup struct {
	Provider string
	Accounts []PickerAccount
}

// GroupPickerAccounts groups accounts by provider (case-insensitive), sorted by
// provider name, with emails sorted inside each group and unidentified logins last.
func GroupPickerAccounts(accounts []PickerAccount) []PickerGroup {
	byProvider := map[string]*PickerGroup{}
	var order []string
	for _, account := range accounts {
		key := strings.ToLower(strings.TrimSpace(account.Provider))
		group, ok := byProvider[key]
		if !ok {
			group = &PickerGroup{Provider: strings.TrimSpace(account.Provider)}
			byProvider[key] = group
			order = append(order, key)
		}
		group.Accounts = append(group.Accounts, account)
	}
	sort.Strings(order)
	groups := make([]PickerGroup, 0, len(order))
	for _, key := range order {
		group := byProvider[key]
		sort.SliceStable(group.Accounts, func(i, j int) bool {
			a, b := strings.ToLower(strings.TrimSpace(group.Accounts[i].Email)), strings.ToLower(strings.TrimSpace(group.Accounts[j].Email))
			if (a == "") != (b == "") {
				return b == ""
			}
			return a < b
		})
		groups = append(groups, *group)
	}
	return groups
}

// pickerRow is one cursor stop: a provider header (account < 0) or a login.
// A provider with a single login has no header; its login row names the provider.
type pickerRow struct {
	group   int
	account int
}

type accountPicker struct {
	groups    []PickerGroup
	rows      []pickerRow
	cursor    int
	done      bool
	cancelled bool
	color     bool
}

func newAccountPicker(groups []PickerGroup, color bool) *accountPicker {
	p := &accountPicker{groups: groups, color: color}
	for gi, group := range groups {
		if len(group.Accounts) > 1 {
			p.rows = append(p.rows, pickerRow{group: gi, account: -1})
		}
		for ai := range group.Accounts {
			p.rows = append(p.rows, pickerRow{group: gi, account: ai})
		}
	}
	return p
}

func (p *accountPicker) Init() tea.Cmd { return nil }

func (p *accountPicker) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	key, ok := msg.(tea.KeyMsg)
	if !ok {
		return p, nil
	}
	switch key.String() {
	case "up", "k", "shift+tab":
		if p.cursor > 0 {
			p.cursor--
		}
	case "down", "j", "tab":
		if p.cursor < len(p.rows)-1 {
			p.cursor++
		}
	case " ", "x":
		p.toggleRow(p.cursor)
	case "a":
		p.setAll(!p.allSelected())
	case "enter":
		p.done = true
		return p, tea.Quit
	case "esc", "q", "ctrl+c":
		p.cancelled = true
		return p, tea.Quit
	}
	return p, nil
}

func (p *accountPicker) toggleRow(index int) {
	if index < 0 || index >= len(p.rows) {
		return
	}
	row := p.rows[index]
	group := &p.groups[row.group]
	if row.account >= 0 {
		account := &group.Accounts[row.account]
		if !account.Locked {
			account.Selected = !account.Selected
		}
		return
	}
	next := groupState(*group) != stateAll
	for i := range group.Accounts {
		if !group.Accounts[i].Locked {
			group.Accounts[i].Selected = next
		}
	}
}

func (p *accountPicker) allSelected() bool {
	for _, group := range p.groups {
		for _, account := range group.Accounts {
			if !account.Locked && !account.Selected {
				return false
			}
		}
	}
	return true
}

func (p *accountPicker) setAll(selected bool) {
	for gi := range p.groups {
		for ai := range p.groups[gi].Accounts {
			if !p.groups[gi].Accounts[ai].Locked {
				p.groups[gi].Accounts[ai].Selected = selected
			}
		}
	}
}

func (p *accountPicker) selection() []PickerAccount {
	var out []PickerAccount
	for _, group := range p.groups {
		out = append(out, group.Accounts...)
	}
	return out
}

const (
	stateNone = iota
	statePartial
	stateAll
)

func groupState(group PickerGroup) int {
	selected := 0
	for _, account := range group.Accounts {
		if account.Selected {
			selected++
		}
	}
	switch {
	case selected == 0:
		return stateNone
	case selected == len(group.Accounts):
		return stateAll
	default:
		return statePartial
	}
}

func (p *accountPicker) paint(style func() lipgloss.Style, s string) string {
	if !p.color {
		return s
	}
	return style().Render(s)
}

func styleBold() lipgloss.Style { return styleBody().Bold(true) }

const (
	markOn      = "●"
	markOff     = "○"
	markPartial = "◐"
	markLocked  = "⊘"
)

func (p *accountPicker) mark(on bool) string {
	if on {
		return p.paint(styleOk, markOn)
	}
	return p.paint(styleMuted, markOff)
}

func (p *accountPicker) groupMark(group PickerGroup) string {
	switch groupState(group) {
	case stateAll:
		return p.paint(styleOk, markOn)
	case statePartial:
		return p.paint(styleOk, markPartial)
	default:
		return p.paint(styleMuted, markOff)
	}
}

func emailLabel(account PickerAccount) string {
	if strings.TrimSpace(account.Email) == "" {
		return "No email on file"
	}
	return strings.ToLower(strings.TrimSpace(account.Email))
}

// accountDetail is the muted text after a login: plan, plus any admin lock.
func accountDetail(account PickerAccount) string {
	detail := account.Plan
	if account.Locked {
		state := "off"
		if account.Selected {
			state = "on"
		}
		detail = strings.TrimPrefix(detail+" · locked "+state+" by your admin", " · ")
	}
	return detail
}

func (p *accountPicker) counts() (on, total int) {
	for _, group := range p.groups {
		for _, account := range group.Accounts {
			total++
			if account.Selected {
				on++
			}
		}
	}
	return on, total
}

// gutter marks the focused row with a teal bar.
func (p *accountPicker) gutter(focused bool) string {
	if !focused {
		return "    "
	}
	if p.color {
		return "  " + styleTeal().Render("▌") + " "
	}
	return "  > "
}

func (p *accountPicker) View() string {
	if p.cancelled {
		return ""
	}
	if p.done {
		return p.summaryView()
	}
	var b strings.Builder
	b.WriteString("\n  " + p.paint(styleYellow, "◆") + "  " + p.paint(styleTeal, "Choose what UseJunction collects") + "\n")
	b.WriteString("     " + p.paint(styleMuted, "Grouped by provider. Each login is its own switch; nothing is collected until you turn it on.") + "\n\n")

	providerWidth, emailWidth := 0, 0
	for _, group := range p.groups {
		if n := lipgloss.Width(group.Provider); n > providerWidth {
			providerWidth = n
		}
		for _, account := range group.Accounts {
			if n := lipgloss.Width(emailLabel(account)); n > emailWidth {
				emailWidth = n
			}
		}
	}
	providerWidth += 3
	emailWidth += 3

	for index, row := range p.rows {
		group := p.groups[row.group]
		focused := index == p.cursor
		single := len(group.Accounts) == 1
		startsGroup := row.account < 0 || (single && row.account == 0)
		if startsGroup && index > 0 {
			b.WriteString("\n")
		}
		if row.account < 0 {
			on := 0
			for _, account := range group.Accounts {
				if account.Selected {
					on++
				}
			}
			label := padRight(group.Provider, providerWidth)
			if focused {
				label = p.paint(styleTeal, label)
			} else {
				label = p.paint(styleBold, label)
			}
			count := p.paint(styleMuted, fmt.Sprintf("%d accounts · %d on", len(group.Accounts), on))
			b.WriteString(p.gutter(focused) + p.groupMark(group) + "  " + label + count + "\n")
			continue
		}
		account := group.Accounts[row.account]
		mark := p.mark(account.Selected)
		if account.Locked {
			mark = p.paint(styleMuted, markLocked)
		}
		email := padRight(emailLabel(account), emailWidth)
		switch {
		case focused:
			email = p.paint(styleTeal, email)
		case account.Locked:
			email = p.paint(styleMuted, email)
		default:
			email = p.paint(styleBody, email)
		}
		detail := p.paint(styleMuted, accountDetail(account))
		if single {
			// One login: the provider is the row, the email sits beside it.
			name := padRight(group.Provider, providerWidth)
			if focused {
				name = p.paint(styleTeal, name)
			} else {
				name = p.paint(styleBold, name)
			}
			b.WriteString(p.gutter(focused) + mark + "  " + name + email + detail + "\n")
			continue
		}
		b.WriteString(p.gutter(focused) + "   " + mark + "  " + email + detail + "\n")
	}

	on, total := p.counts()
	b.WriteString("\n  " + p.paint(styleMuted, strings.Repeat("─", 4+3+providerWidth+emailWidth+8)) + "\n")
	countLine := fmt.Sprintf("%d of %d accounts will be collected", on, total)
	if on == 0 {
		countLine = fmt.Sprintf("No accounts selected · 0 of %d will be collected", total)
	}
	b.WriteString("  " + p.paint(styleTeal, countLine) + "\n")
	keys := [][2]string{{"↑↓", "move"}, {"space", "toggle"}, {"a", "all"}, {"enter", "confirm"}, {"esc", "skip"}}
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, p.paint(styleBody, k[0])+" "+p.paint(styleMuted, k[1]))
	}
	b.WriteString("  " + strings.Join(parts, p.paint(styleMuted, "   ")) + "\n")
	return b.String()
}

// summaryView stays on screen after confirm: one line per provider.
func (p *accountPicker) summaryView() string {
	var b strings.Builder
	on, total := p.counts()
	b.WriteString(fmt.Sprintf("  %s  %s\n", p.paint(styleOk, "✓"), p.paint(styleBody, "Accounts chosen")+p.paint(styleMuted, fmt.Sprintf("  %d of %d on", on, total))))
	providerWidth := 0
	for _, group := range p.groups {
		if n := lipgloss.Width(group.Provider); n > providerWidth {
			providerWidth = n
		}
	}
	for _, group := range p.groups {
		var onEmails []string
		for _, account := range group.Accounts {
			if account.Selected {
				onEmails = append(onEmails, emailLabel(account))
			}
		}
		detail := p.paint(styleMuted, "off")
		if len(onEmails) > 0 {
			detail = p.paint(styleBody, strings.Join(onEmails, ", "))
		}
		b.WriteString("      " + p.groupMark(group) + "  " + p.paint(styleMuted, padRight(group.Provider, providerWidth+2)) + detail + "\n")
	}
	return b.String()
}

// PickAccounts shows an interactive grouped picker on in/out and returns every
// account with its final Selected value. ok is false when the user skipped.
func PickAccounts(groups []PickerGroup, in io.Reader, w io.Writer) (accounts []PickerAccount, ok bool, err error) {
	picker := newAccountPicker(groups, !forceNoColor)
	program := tea.NewProgram(picker, tea.WithInput(in), tea.WithOutput(w))
	if _, err := program.Run(); err != nil {
		return nil, false, err
	}
	if picker.cancelled {
		return nil, false, nil
	}
	return picker.selection(), true, nil
}
