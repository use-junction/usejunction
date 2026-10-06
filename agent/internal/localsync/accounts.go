package localsync

import (
	"encoding/json"
	"html"
	"io"
	"net/http"
	"strings"

	"github.com/usejunction/agent/internal/accountpolicy"
	"github.com/usejunction/agent/internal/client"
)

func (s *Server) handleAccounts(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	api := client.New(s.cfg)
	switch r.Method {
	case http.MethodGet:
		if wantsHTML(r) {
			s.writeAccountsPage(w)
			return
		}
		policy, err := api.AccountPolicy()
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		writeJSON(w, http.StatusOK, policy)
	case http.MethodPatch:
		body, err := io.ReadAll(io.LimitReader(r.Body, 8*1024))
		if err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		var patch client.AccountPolicyPatch
		if err := json.Unmarshal(body, &patch); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		if patch.ToolName == "" {
			http.Error(w, "toolName is required", http.StatusBadRequest)
			return
		}
		if patch.Scope != "provider" && patch.Scope != "account" && patch.Stream != accountpolicy.StreamUsage && patch.Stream != accountpolicy.StreamLogging {
			http.Error(w, "scope or stream is required", http.StatusBadRequest)
			return
		}
		account, err := api.PatchAccountPolicy(patch)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"account": account})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func wantsHTML(r *http.Request) bool {
	accept := strings.ToLower(r.Header.Get("Accept"))
	if strings.Contains(accept, "application/json") && !strings.Contains(accept, "text/html") {
		return false
	}
	return strings.Contains(accept, "text/html") || accept == "" || strings.Contains(accept, "*/*")
}

func (s *Server) writeAccountsPage(w http.ResponseWriter) {
	token := html.EscapeString(strings.TrimSpace(s.cfg.LocalSyncToken))
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>UseJunction accounts</title>
<style>
  :root { color-scheme: light dark; --ink:#111; --muted:#5c5c5c; --line:#d6d6d6; --ok:#0b6e4f; }
  html { background: Canvas; color: CanvasText; }
  body { font: 15px/1.45 ui-sans-serif, system-ui, sans-serif; margin: 0; color: var(--ink); }
  main { max-width: 36rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
  h1 { font-size: 1.35rem; letter-spacing: -0.03em; margin: 0 0 .4rem; }
  p { color: var(--muted); margin: 0 0 1.5rem; }
  article { border: 1px solid var(--line); padding: 1rem 1.1rem; margin-bottom: .75rem; }
  h2 { font-size: 1rem; margin: 0 0 .2rem; }
  .head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; margin-bottom: .75rem; }
  .meta { font-size: .85rem; color: var(--muted); }
  .account { border-top: 1px solid var(--line); padding: .75rem 0 0; margin-top: .75rem; }
  .actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .5rem; }
  .lock { font-size: .8rem; color: #8a1f1f; }
  .empty { border: 1px dashed var(--line); padding: 1.25rem; color: var(--muted); }
</style>
</head>
<body>
<main>
  <h1>Collection on this Mac</h1>
  <p>Every login on this Mac is its own switch. Turn on usage for the accounts you want collected — one, several, or all of them.</p>
  <div id="list" class="empty">Loading accounts…</div>
</main>
<script>
const token = `+"`"+token+"`"+`;
async function load() {
  const res = await fetch("/v1/accounts?token=" + encodeURIComponent(token), { headers: { Accept: "application/json" } });
  const data = await res.json();
  const accounts = data.accounts || [];
  const root = document.getElementById("list");
  if (!accounts.length) {
    root.className = "empty";
    root.textContent = "No provider account has been seen on this device yet.";
    return;
  }
  const providers = new Map();
  for (const account of accounts) {
    const rows = providers.get(account.toolName) || [];
    rows.push(account);
    providers.set(account.toolName, rows);
  }
  function esc(value) {
    return String(value || "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }
  root.className = "";
  root.innerHTML = [...providers.entries()].map(([toolName, rows]) => {
    const name = rows[0].displayName || toolName;
    const collecting = rows.filter((account) => account.usageAllowed).length;
    const sorted = [...rows].sort((a, b) => Number(b.authPresent) - Number(a.authPresent));
    const accountsHtml = sorted.map((account) => {
      const who = account.email || account.accountKey || "Account";
      const lockedUsage = account.usageAdminLocked;
      return '<div class="account" data-tool="' + esc(toolName) + '" data-key="' + encodeURIComponent(account.accountKey) + '">' +
        '<div class="meta">' + esc(who) +
          (account.plan ? " · " + esc(account.plan) : "") +
          (account.authPresent ? " · signed in" : " · seen on this Mac") +
          (account.usageAllowed ? " · usage collecting" : " · usage off") +
        "</div>" +
        '<div class="actions">' +
          '<button type="button" data-action="usage"' + (lockedUsage ? " disabled" : "") + ">" +
            (account.usageEnabled ? "Turn usage off" : "Collect usage") +
          "</button>" +
        "</div>" +
        (lockedUsage ? '<p class="lock">An admin lock is on for this account.</p>' : "") +
      "</div>";
    }).join("");
    return '<article data-tool="' + esc(toolName) + '">' +
      '<div class="head"><h2>' + esc(name) + "</h2>" +
      (collecting ? '<button type="button" data-action="disable">Turn off all accounts</button>' : "") +
      "</div>" +
      '<div class="meta">' + collecting + " of " + rows.length + " collecting</div>" +
      accountsHtml +
      "</article>";
  }).join("");
  root.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => save(button));
  });
}
async function save(button) {
  const row = button.closest(".account") || button.closest("article");
  button.disabled = true;
  const action = button.dataset.action;
  const body = action === "disable" ? {
    scope: "provider",
    toolName: row.dataset.tool,
    enabled: false
  } : {
    toolName: row.dataset.tool,
    accountKey: decodeURIComponent(row.dataset.key || ""),
    stream: action,
    enabled: button.textContent.indexOf("Collect") === 0
  };
  await fetch("/v1/accounts?token=" + encodeURIComponent(token), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await load();
}
load().catch((err) => {
  document.getElementById("list").textContent = String(err);
});
</script>
</body>
</html>`)
}
