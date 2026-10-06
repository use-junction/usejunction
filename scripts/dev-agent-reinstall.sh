#!/usr/bin/env bash
# Rebuild the UseJunction agent from this checkout and reinstall it.
# Darwin app lives in ~/Applications; data stays under ~/.usejunction-test.
# Dev-only: bypasses install.sh release/semver gates. Does not enroll or publish a release.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_SRC="${ROOT}/agent"
AGENT_PROFILE="${USEJUNCTION_PROFILE:-test}"

case "$AGENT_PROFILE" in
  test)
    HOME_DIR="${HOME}/.usejunction-test"
    APP_NAME="UseJunctionTest"
    CLI_NAME="usejunction-test"
    LAUNCHD_LABEL="com.usejunction.agent.test"
    LAUNCHD_PLIST="com.usejunction.agent.test.plist"
    SYSTEMD_UNIT="usejunction-agent-test.service"
    ;;
  default)
    HOME_DIR="${HOME}/.usejunction"
    APP_NAME="UseJunction"
    CLI_NAME="usejunction"
    LAUNCHD_LABEL="com.usejunction.agent"
    LAUNCHD_PLIST="com.usejunction.agent.plist"
    SYSTEMD_UNIT="usejunction-agent.service"
    ;;
  *)
    echo "Unknown USEJUNCTION_PROFILE=${AGENT_PROFILE} (expected test or default)" >&2
    exit 1
    ;;
esac

INSTALL_DIR="${HOME_DIR}/bin"
APPS_DIR="${HOME}/Applications"
APP_DIR="${APPS_DIR}/${APP_NAME}.app"
PREVIOUS_APP="${APPS_DIR}/${APP_NAME}.previous.app"
HIDDEN_APP_DIR="${HOME_DIR}/${APP_NAME}.app"
LEGACY_APP_DIR="${HOME_DIR}/UseJunction Agent.app"
CONFIG_PATH="${HOME_DIR}/config.json"
PLIST="${HOME}/Library/LaunchAgents/${LAUNCHD_PLIST}"
DEV_SOURCE_FILE="${HOME_DIR}/dev-source"
AGENT_LOG="${HOME_DIR}/agent.log"
AGENT_ERR="${HOME_DIR}/agent.err"
LOCK_FILE="${TMPDIR:-/tmp}/usejunction-dev-agent-reinstall.lock"
LOCK_DIR="${LOCK_FILE}.d"
PACKAGE_SCRIPT="${ROOT}/scripts/package-macos-app.sh"
tmpdir=""
lock_held=0

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"

usage() {
  cat <<EOF
Usage: ./scripts/dev-agent-reinstall.sh

Rebuilds the local agent from source, swaps it into ${HOME_DIR}, and restarts
the background daemon. Requires an existing enrollment (config.json).

Set USEJUNCTION_PROFILE=default to rebuild the production agent home instead.

Fails if the daemon cannot be restarted onto the new binary (so a stale process
cannot keep running from UseJunction.previous.app).
EOF
}

cleanup() {
  if [[ -n "$tmpdir" ]]; then
    rm -rf "$tmpdir"
  fi
  if [[ "$lock_held" -eq 1 ]]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -f "${AGENT_SRC}/main.go" ]]; then
  echo "Agent source not found at ${AGENT_SRC}/main.go" >&2
  exit 1
fi

if ! command -v go >/dev/null 2>&1; then
  echo "Go is required to rebuild the agent." >&2
  exit 1
fi

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "No existing enrollment at ${CONFIG_PATH}." >&2
  echo "Enroll first, then re-run this script:" >&2
  if [[ "$AGENT_PROFILE" == "test" ]]; then
    echo "  ./install.sh --token <token> --url http://localhost:3001" >&2
  else
    echo "  ./install.sh --token <token> --url <control-plane>" >&2
  fi
  exit 1
fi

agent_profile_args() {
  if [[ "$AGENT_PROFILE" == "test" ]]; then
    printf '%s\n' --profile test
  fi
}

# Serialize overlapping watcher rebuilds so the app swap cannot race.
# Prefer flock when available; fall back to a mkdir lock (portable on macOS).
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "Another agent reinstall is already running; waiting…"
    flock 9
  fi
else
  waited=0
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    if [[ $waited -eq 0 ]]; then
      echo "Another agent reinstall is already running; waiting…"
    fi
    sleep 0.25
    waited=$((waited + 1))
    if [[ $waited -gt 240 ]]; then
      echo "Timed out waiting for agent reinstall lock." >&2
      exit 1
    fi
  done
  lock_held=1
fi

short_sha="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || true)"
if [[ -z "$short_sha" ]]; then
  short_sha="nogit"
fi
unix_ts="$(date +%s)"
VERSION="0.0.0-dev.${short_sha}.${unix_ts}"

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/usejunction-dev-agent.XXXXXX")"
tmp_binary="${tmpdir}/usejunction"
echo "Building agent v${VERSION} from ${AGENT_SRC}…"
(
  cd "$AGENT_SRC"
  go build -ldflags "-X github.com/usejunction/agent/internal/config.Version=${VERSION}" -o "$tmp_binary" .
)

darwin_domain() {
  printf 'gui/%s' "$(id -u)"
}

darwin_label() {
  printf '%s/%s' "$(darwin_domain)" "$LAUNCHD_LABEL"
}

# Stop the launchd/systemd job before replacing binaries so the old process
# cannot keep executing from a renamed .previous.app path.
stop_daemon() {
  case "$OS" in
    darwin)
      local domain label
      domain="$(darwin_domain)"
      label="$(darwin_label)"
      if [[ -f "$PLIST" ]]; then
        launchctl bootout "$domain" "$PLIST" 2>/dev/null || true
        launchctl unload "$PLIST" 2>/dev/null || true
      fi
      # Best-effort: kill any leftover daemon still mapped to previous/current app.
      pkill -f "${HOME_DIR}/.*usejunction.*daemon" 2>/dev/null || true
      sleep 0.3
      ;;
    linux)
      if command -v systemctl >/dev/null 2>&1; then
        systemctl --user stop "${SYSTEMD_UNIT}" 2>/dev/null || true
      fi
      ;;
  esac
}

restart_daemon() {
  case "$OS" in
    darwin)
      local domain label
      domain="$(darwin_domain)"
      label="$(darwin_label)"
      ensure_launchd_plist
      if [[ ! -f "$PLIST" ]]; then
        echo "launchd plist not found at ${PLIST}; binary was updated but daemon was not restarted." >&2
        return 1
      fi
      # Prefer kickstart -k when the job is already loaded.
      if launchctl kickstart -k "$label" 2>/dev/null; then
        return 0
      fi
      # Job was booted out — bootstrap then kickstart. Never bare-load alone.
      launchctl bootout "$domain" "$PLIST" 2>/dev/null || true
      if launchctl bootstrap "$domain" "$PLIST" 2>/dev/null; then
        launchctl kickstart -k "$label" 2>/dev/null || true
        return 0
      fi
      launchctl unload "$PLIST" 2>/dev/null || true
      if launchctl load "$PLIST" 2>/dev/null; then
        launchctl kickstart -k "$label" 2>/dev/null || true
        return 0
      fi
      echo "Failed to restart launchd agent ${label}." >&2
      return 1
      ;;
    linux)
      if ! command -v systemctl >/dev/null 2>&1; then
        echo "systemctl not available; binary was updated but daemon was not restarted." >&2
        return 1
      fi
      systemctl --user daemon-reload 2>/dev/null || true
      systemctl --user restart "${SYSTEMD_UNIT}"
      return 0
      ;;
    *)
      echo "Automatic restart is unsupported on ${OS}." >&2
      return 1
      ;;
  esac
}

# Recreate the launchd agent if onboarding wiped it or never enrolled via install.sh.
ensure_launchd_plist() {
  [[ "$OS" == "darwin" ]] || return 0
  local binary="${APP_DIR}/Contents/MacOS/usejunction"
  if [[ ! -x "$binary" ]]; then
    return 0
  fi
  mkdir -p "$(dirname "$PLIST")"
  if [[ "$AGENT_PROFILE" == "test" ]]; then
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${binary}</string>
    <string>--profile</string>
    <string>test</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${AGENT_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${AGENT_ERR}</string>
</dict>
</plist>
EOF
  else
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${binary}</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${AGENT_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${AGENT_ERR}</string>
</dict>
</plist>
EOF
  fi
}

# Pin this checkout so curl|install.sh and OTA cannot silently replace 0.0.0-dev.
write_dev_source_pin() {
  mkdir -p "${HOME_DIR}"
  printf '%s\n' "$ROOT" > "$DEV_SOURCE_FILE"
  echo "Pinned local checkout at ${DEV_SOURCE_FILE} → ${ROOT}"
}

# Confirm the running daemon is the new app binary, not a stale .previous.app process.
verify_daemon() {
  local binary="$1"
  local expected_version="$2"
  case "$OS" in
    darwin)
      local i cmd_line
      for i in 1 2 3 4 5 6 7 8 9 10; do
        if pgrep -f "${PREVIOUS_APP}/Contents/MacOS/usejunction" >/dev/null 2>&1; then
          echo "Stale daemon still running from ${PREVIOUS_APP}." >&2
          return 1
        fi
        if pgrep -f "${APP_DIR}/Contents/MacOS/usejunction" >/dev/null 2>&1 \
          || pgrep -f 'UseJunction\.app/Contents/MacOS/usejunction' >/dev/null 2>&1; then
          break
        fi
        sleep 0.3
        if [[ $i -eq 10 ]]; then
          echo "Daemon did not start from ${APP_DIR} after restart." >&2
          return 1
        fi
      done
      ;;
    linux)
      if command -v systemctl >/dev/null 2>&1; then
        if ! systemctl --user is-active --quiet "${SYSTEMD_UNIT}"; then
          echo "${SYSTEMD_UNIT} is not active after restart." >&2
          return 1
        fi
      fi
      ;;
  esac

  if [[ ! -x "$binary" ]]; then
    echo "Installed binary is not executable: ${binary}" >&2
    return 1
  fi

  local status_json
  if ! status_json="$("$binary" $(agent_profile_args) status --format json 2>/dev/null)"; then
    echo "Could not run status on installed binary: ${binary}" >&2
    return 1
  fi
  if ! printf '%s' "$status_json" | grep -Eq "\"agentVersion\"[[:space:]]*:[[:space:]]*\"${expected_version}\""; then
    echo "Installed binary status version mismatch (expected ${expected_version})." >&2
    echo "$status_json" >&2
    return 1
  fi
  return 0
}

install_macos() {
  if [[ ! -f "$PACKAGE_SCRIPT" ]]; then
    echo "Missing packaging script: ${PACKAGE_SCRIPT}" >&2
    exit 1
  fi
  mkdir -p "$APPS_DIR"
  local staged_app="${APPS_DIR}/${APP_NAME}.new.app"
  rm -rf "$staged_app" "$PREVIOUS_APP"
  bash "$PACKAGE_SCRIPT" "$tmp_binary" "$staged_app" "$VERSION"
  if [[ -d "$LEGACY_APP_DIR" && ! -d "$APP_DIR" ]]; then
    mv "$LEGACY_APP_DIR" "$APP_DIR"
  elif [[ -d "$LEGACY_APP_DIR" ]]; then
    rm -rf "$LEGACY_APP_DIR"
  fi
  if [[ -d "$HIDDEN_APP_DIR" && ! -d "$APP_DIR" ]]; then
    mv "$HIDDEN_APP_DIR" "$APP_DIR"
  fi
  if [[ -d "$APP_DIR" ]]; then
    mv "$APP_DIR" "$PREVIOUS_APP"
  fi
  if ! mv "$staged_app" "$APP_DIR"; then
    [[ -d "$PREVIOUS_APP" ]] && mv "$PREVIOUS_APP" "$APP_DIR"
    echo "Failed to swap macOS app bundle into place." >&2
    exit 1
  fi
  mkdir -p "$INSTALL_DIR"
  ln -sfn "${APP_DIR}/Contents/MacOS/usejunction" "${INSTALL_DIR}/${CLI_NAME}"
  rm -rf "$HIDDEN_APP_DIR" \
    "${HOME_DIR}/${APP_NAME}.previous.app" \
    "${HOME_DIR}/${APP_NAME}.app.previous" \
    "$LEGACY_APP_DIR"
}

install_linux() {
  mkdir -p "$INSTALL_DIR"
  local destination="${INSTALL_DIR}/${CLI_NAME}"
  local staged="${destination}.new"
  local previous="${destination}.previous"
  cp "$tmp_binary" "$staged"
  chmod +x "$staged"
  rm -f "$previous"
  if [[ -e "$destination" ]]; then
    mv "$destination" "$previous"
  fi
  if ! mv "$staged" "$destination"; then
    [[ -e "$previous" ]] && mv "$previous" "$destination"
    echo "Failed to install agent binary." >&2
    exit 1
  fi
}

echo "Stopping background agent before binary swap…"
stop_daemon

case "$OS" in
  darwin) install_macos ;;
  linux) install_linux ;;
  *)
    echo "Unsupported OS for local agent reinstall: ${OS}" >&2
    exit 1
    ;;
esac

write_dev_source_pin

echo "Restarting background agent…"
if ! restart_daemon; then
  echo "Agent binary was installed but daemon restart failed." >&2
  exit 1
fi

binary="${INSTALL_DIR}/${CLI_NAME}"
if [[ "$OS" == "darwin" ]]; then
  binary="${APP_DIR}/Contents/MacOS/usejunction"
fi

if ! verify_daemon "$binary" "$VERSION"; then
  echo "Agent reinstall verification failed for v${VERSION}." >&2
  exit 1
fi

echo "Repairing legacy tool configs if needed…"
# shellcheck disable=SC2046
if ! "$binary" $(agent_profile_args) doctor --format json >/dev/null 2>&1; then
  echo "Warning: legacy config repair reported an issue (see ${CLI_NAME} doctor)." >&2
fi

echo "Installed UseJunction agent v${VERSION} (${AGENT_PROFILE} profile)."
# shellcheck disable=SC2046
"$binary" $(agent_profile_args) status || true
