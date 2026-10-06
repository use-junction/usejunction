package ui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func pickerFixture() []PickerGroup {
	return GroupPickerAccounts([]PickerAccount{
		{ID: "cursor-work", Email: "me@acme.dev", Provider: "Cursor", Plan: "Business"},
		{ID: "codex-home", Email: "Me@Gmail.com", Provider: "Codex", Plan: "Plus"},
		{ID: "cursor-home", Email: "me@gmail.com", Provider: "Cursor", Plan: "Pro"},
		{ID: "claude-anon", Provider: "Claude"},
		{ID: "copilot-work", Email: "me@acme.dev", Provider: "Copilot", Locked: true},
		{ID: "cursor-locked", Email: "me@corp.dev", Provider: "Cursor", Locked: true},
	})
}

// Rows: 0 claude-anon, 1 codex-home, 2 copilot-work, 3 Cursor header,
// 4 cursor-work, 5 cursor-locked, 6 cursor-home.

func TestGroupPickerAccountsGroupsByProvider(t *testing.T) {
	groups := pickerFixture()
	var got []string
	for _, group := range groups {
		var names []string
		for _, account := range group.Accounts {
			names = append(names, account.ID)
		}
		got = append(got, group.Provider+"="+strings.Join(names, ","))
	}
	want := []string{
		"Claude=claude-anon",
		"Codex=codex-home",
		"Copilot=copilot-work",
		"Cursor=cursor-work,cursor-locked,cursor-home",
	}
	if strings.Join(got, " | ") != strings.Join(want, " | ") {
		t.Fatalf("groups = %v, want %v", got, want)
	}
}

func selectedIDs(p *accountPicker) string {
	var ids []string
	for _, account := range p.selection() {
		if account.Selected {
			ids = append(ids, account.ID)
		}
	}
	return strings.Join(ids, ",")
}

func press(p *accountPicker, keys ...string) {
	for _, key := range keys {
		var msg tea.KeyMsg
		switch key {
		case "down":
			msg = tea.KeyMsg{Type: tea.KeyDown}
		case "up":
			msg = tea.KeyMsg{Type: tea.KeyUp}
		case "enter":
			msg = tea.KeyMsg{Type: tea.KeyEnter}
		case "esc":
			msg = tea.KeyMsg{Type: tea.KeyEsc}
		case " ":
			msg = tea.KeyMsg{Type: tea.KeySpace, Runes: []rune{' '}}
		default:
			msg = tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(key)}
		}
		p.Update(msg)
	}
}

func TestPickerGroupToggleSkipsLockedAccounts(t *testing.T) {
	p := newAccountPicker(pickerFixture(), false)
	press(p, "down", "down", "down", " ") // Cursor header
	if got := selectedIDs(p); got != "cursor-work,cursor-home" {
		t.Fatalf("selected = %q, want cursor-work,cursor-home (cursor-locked is locked)", got)
	}
}

func TestPickerSingleAccountAndSelectAll(t *testing.T) {
	p := newAccountPicker(pickerFixture(), false)
	press(p, "down", "down", "down", "down", "down", "down", " ") // cursor-home
	if got := selectedIDs(p); got != "cursor-home" {
		t.Fatalf("selected = %q, want cursor-home", got)
	}
	press(p, "a")
	if got := selectedIDs(p); got != "claude-anon,codex-home,cursor-work,cursor-home" {
		t.Fatalf("after all = %q", got)
	}
	press(p, "a")
	if got := selectedIDs(p); got != "" {
		t.Fatalf("after none = %q", got)
	}
	press(p, "enter")
	if !p.done || p.cancelled {
		t.Fatal("enter should confirm")
	}
}

func TestPickerEscSkips(t *testing.T) {
	p := newAccountPicker(pickerFixture(), false)
	press(p, " ", "esc")
	if !p.cancelled {
		t.Fatal("esc should skip")
	}
}

func TestPickerViewGroupsByProvider(t *testing.T) {
	p := newAccountPicker(pickerFixture(), false)
	press(p, "down", "down", "down", " ")
	view := p.View()
	for _, want := range []string{
		"◐  Cursor",
		"3 accounts · 2 on",
		"●  me@acme.dev",
		"locked off by your admin",
		"○  Claude",
		"No email on file",
		"○  Codex",
		"me@gmail.com",
		"2 of 6 accounts will be collected",
	} {
		if !strings.Contains(view, want) {
			t.Fatalf("view missing %q:\n%s", want, view)
		}
	}
	press(p, "enter")
	summary := p.View()
	for _, want := range []string{"Accounts chosen", "Cursor", "me@acme.dev, me@gmail.com", "Codex"} {
		if !strings.Contains(summary, want) {
			t.Fatalf("summary missing %q:\n%s", want, summary)
		}
	}
}
