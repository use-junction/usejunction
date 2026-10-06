#!/usr/bin/env bash
# Watch agent sources and rebuild/reinstall (macOS app in ~/Applications; data in ~/.usejunction-test).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="${ROOT}/agent"
REINSTALL="${ROOT}/scripts/dev-agent-reinstall.sh"
DEBOUNCE_MS="${USEJUNCTION_AGENT_WATCH_DEBOUNCE_MS:-750}"
FLAG_FILE="${TMPDIR:-/tmp}/usejunction-dev-agent-watch.flag"

usage() {
  cat <<'EOF'
Usage: ./scripts/dev-agent-watch.sh

Watches agent/ for Go and macOS bundle changes, then runs
scripts/dev-agent-reinstall.sh after a short debounce.

Uses fswatch when available; otherwise polls with find.
Requires an existing local enrollment under ~/.usejunction-test (see README).
Set USEJUNCTION_PROFILE=default to watch the production agent home instead.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -f "$REINSTALL" ]]; then
  echo "Missing reinstall script: ${REINSTALL}" >&2
  exit 1
fi
chmod +x "$REINSTALL" 2>/dev/null || true

if [[ ! -d "$AGENT_DIR" ]]; then
  echo "Agent directory not found: ${AGENT_DIR}" >&2
  exit 1
fi

is_watched_path() {
  local path="$1"
  case "$path" in
    *.go|*/go.mod|*/go.sum|*/macos/*|*/macos) return 0 ;;
    *) return 1 ;;
  esac
}

run_reinstall() {
  echo
  echo "[$(date '+%H:%M:%S')] Rebuilding and reinstalling local agent…"
  if bash "$REINSTALL"; then
    echo "[$(date '+%H:%M:%S')] Agent reinstall succeeded."
  else
    echo "[$(date '+%H:%M:%S')] ERROR: agent reinstall FAILED — daemon may still be on the old binary." >&2
    echo "[$(date '+%H:%M:%S')] Fix the error above and save again, or run: pnpm agent:reinstall" >&2
    if command -v printf >/dev/null 2>&1; then
      # Terminal bell so a failed restart is obvious in a long watch session.
      printf '\a' >&2 || true
    fi
  fi
}

fingerprint() {
  (
    cd "$AGENT_DIR"
    if find . -type f \( -name '*.go' -o -name 'go.mod' -o -name 'go.sum' -o -path './macos/*' \) \
      ! -path './.git/*' -print0 2>/dev/null \
      | sort -z \
      | xargs -0 stat -f '%N %m %z' 2>/dev/null; then
      return 0
    fi
    find . -type f \( -name '*.go' -o -name 'go.mod' -o -name 'go.sum' -o -path './macos/*' \) \
      ! -path './.git/*' -printf '%p %T@ %s\n' 2>/dev/null | sort
  )
}

debounce_seconds() {
  awk -v ms="$DEBOUNCE_MS" 'BEGIN { printf "%.3f", ms / 1000 }'
}

cleanup_watch() {
  rm -f "$FLAG_FILE"
  if [[ -n "${FSWATCH_PID:-}" ]]; then
    kill "$FSWATCH_PID" 2>/dev/null || true
  fi
}
trap cleanup_watch EXIT INT TERM

echo "Watching ${AGENT_DIR} for agent changes (debounce ${DEBOUNCE_MS}ms)…"
echo "Press Ctrl-C to stop."
run_reinstall

debounce="$(debounce_seconds)"

if command -v fswatch >/dev/null 2>&1; then
  echo "Using fswatch for filesystem events."
  rm -f "$FLAG_FILE"
  fswatch -0 -r -e '/\.git/' "$AGENT_DIR" | while IFS= read -r -d '' path; do
    if is_watched_path "$path"; then
      : >"$FLAG_FILE"
    fi
  done &
  FSWATCH_PID=$!

  while kill -0 "$FSWATCH_PID" 2>/dev/null; do
    if [[ -f "$FLAG_FILE" ]]; then
      rm -f "$FLAG_FILE"
      sleep "$debounce"
      # Coalesce any events that arrived during the quiet window.
      rm -f "$FLAG_FILE"
      run_reinstall
    else
      sleep 0.2
    fi
  done
  wait "$FSWATCH_PID" 2>/dev/null || true
  exit 0
fi

echo "fswatch not found; falling back to polling (brew install fswatch for event-driven watches)."
last="$(fingerprint || true)"
while true; do
  sleep "$debounce"
  current="$(fingerprint || true)"
  if [[ "$current" != "$last" ]]; then
    # Extra quiet window to coalesce save storms.
    sleep "$debounce"
    current="$(fingerprint || true)"
    last="$current"
    run_reinstall
  fi
done
