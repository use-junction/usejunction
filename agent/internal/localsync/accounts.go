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
  .meta { font-size: .85rem; color: var(--muted); margin-bottom: .8rem; }
  label { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .35rem 0; }
  .lock { font-size: .8rem; color: #8a1f1f; }
  .empty { border: 1px dashed var(--line); padding: 1.25rem; color: var(--muted); }
</style>
</head>
<body>
<main>
  <h1>Collection on this Mac</h1>
  <p>Click a provider to turn it off. Collection stays off until you opt in the account that is signed in.</p>
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
  root.className = "";
  root.innerHTML = [...providers.entries()].map(([toolName, rows]) => {
    const name = rows[0].displayName || toolName;
    const on = rows.some((account) => account.usageAllowed || account.loggingAllowed);
    const selected = rows.find((account) => account.authPresent) || rows[0];
    const who = selected.email || selected.accountKey || "Account";
    return '<article data-tool="' + toolName + '" data-key="' + selected.accountKey + '">' +
      "<h2>" + name + "</h2>" +
      '<div class="meta">' + who + (selected.plan ? " · " + selected.plan : "") + (selected.authPresent ? " · signed in" : "") + "</div>" +
      '<button type="button" data-action="disable"' + (on ? "" : " disabled") + ">Disable provider</button> " +
      '<button type="button" data-action="optin">' + ((selected.usageEnabled || selected.loggingEnabled) ? "Turn off this account" : "Opt in this account") + "</button>" +
      "</article>";
  }).join("");
  root.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => save(button));
  });
}
async function save(button) {
  const article = button.closest("article");
  button.disabled = true;
  const optIn = button.dataset.action === "optin";
  await fetch("/v1/accounts?token=" + encodeURIComponent(token), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(optIn ? {
      scope: "account",
      toolName: article.dataset.tool,
      accountKey: article.dataset.key,
      enabled: button.textContent.indexOf("Opt in") === 0
    } : {
      scope: "provider",
      toolName: article.dataset.tool,
      enabled: false
    })
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
