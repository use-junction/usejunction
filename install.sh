#!/usr/bin/env bash
set -euo pipefail

ENROLL_TOKEN=""
CONTROL_PLANE_URL="${USEJUNCTION_URL:-http://localhost:3001}"
AGENT_PROFILE="${USEJUNCTION_PROFILE:-default}"
VERSION="0.1.0"
UPGRADE_ONLY=false
RESUME_ONLY=false

# Profile paths — resolved by resolve_profile_paths after args/URL are known.
HOME_DIR=""
INSTALL_DIR=""
APP_NAME=""
APPS_DIR=""
APP_DIR=""
HIDDEN_APP_DIR=""
LEGACY_APP_DIR=""
CLI_NAME=""
LAUNCHD_LABEL=""
LAUNCHD_PLIST=""
SYSTEMD_UNIT=""
PATH_MARKER=""
DEV_SOURCE_FILE=""
CONFIG_PATH=""
AGENT_LOG=""
AGENT_ERR=""
BINARY=""

usage() {
  echo "Usage: curl -fsSL <control-plane>/install.sh | sh -s -- [--token <token> | --upgrade | --resume] [--url <control-plane>] [--profile default|test]"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token|--enroll-token) ENROLL_TOKEN="$2"; shift 2 ;;
    --url) CONTROL_PLANE_URL="$2"; shift 2 ;;
    --profile) AGENT_PROFILE="$2"; shift 2 ;;
    --upgrade) UPGRADE_ONLY=true; shift ;;
    --resume) RESUME_ONLY=true; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

CONTROL_PLANE_URL="${CONTROL_PLANE_URL%/}"

is_local_control_plane() {
  case "$CONTROL_PLANE_URL" in
    http://localhost:*|https://localhost:*|http://127.0.0.1:*|https://127.0.0.1:*|http://[::1]:*|https://[::1]:*)
      return 0
      ;;
  esac
  return 1
}

resolve_profile_paths() {
  if [[ "$AGENT_PROFILE" == "default" ]] && is_local_control_plane; then
    AGENT_PROFILE="test"
  fi
  case "$AGENT_PROFILE" in
    test)
      HOME_DIR="${HOME}/.usejunction-test"
      APP_NAME="UseJunctionTest"
      CLI_NAME="usejunction-test"
      LAUNCHD_LABEL="com.usejunction.agent.test"
      LAUNCHD_PLIST="com.usejunction.agent.test.plist"
      SYSTEMD_UNIT="usejunction-agent-test.service"
      PATH_MARKER="# UseJunction CLI (test)"
      ;;
    default)
      HOME_DIR="${HOME}/.usejunction"
      APP_NAME="UseJunction"
      CLI_NAME="usejunction"
      LAUNCHD_LABEL="com.usejunction.agent"
      LAUNCHD_PLIST="com.usejunction.agent.plist"
      SYSTEMD_UNIT="usejunction-agent.service"
      PATH_MARKER="# UseJunction CLI"
      ;;
    *)
      echo "Unknown agent profile: ${AGENT_PROFILE} (expected default or test)" >&2
      exit 1
      ;;
  esac
  INSTALL_DIR="${HOME_DIR}/bin"
  APPS_DIR="${HOME}/Applications"
  APP_DIR="${APPS_DIR}/${APP_NAME}.app"
  HIDDEN_APP_DIR="${HOME_DIR}/${APP_NAME}.app"
  LEGACY_APP_DIR="${HOME_DIR}/UseJunction Agent.app"
  DEV_SOURCE_FILE="${HOME_DIR}/dev-source"
  CONFIG_PATH="${HOME_DIR}/config.json"
  AGENT_LOG="${HOME_DIR}/agent.log"
  AGENT_ERR="${HOME_DIR}/agent.err"
  BINARY="${INSTALL_DIR}/${CLI_NAME}"
}

resolve_profile_paths
FORCE_RELEASE="${USEJUNCTION_FORCE_RELEASE:-0}"

# Prefer the checkout pinned by pnpm agent:reinstall / dev:agent so curl|install.sh
# does not silently download a published release over a local 0.0.0-dev binary.
if [[ -z "${USEJUNCTION_ROOT:-}" && -f "$DEV_SOURCE_FILE" ]]; then
  pinned_root="$(tr -d '\r\n' < "$DEV_SOURCE_FILE" 2>/dev/null || true)"
  if [[ -n "$pinned_root" && -f "${pinned_root}/agent/main.go" ]]; then
    USEJUNCTION_ROOT="$pinned_root"
    export USEJUNCTION_ROOT
    echo "Using pinned local checkout from ${DEV_SOURCE_FILE}: ${USEJUNCTION_ROOT}"
  fi
fi

if [[ "$UPGRADE_ONLY" == true && "$RESUME_ONLY" == true ]]; then
  echo "--upgrade and --resume cannot be used together." >&2
  exit 1
fi

if [[ -z "$ENROLL_TOKEN" && "$UPGRADE_ONLY" != true && "$RESUME_ONLY" != true ]]; then
  usage
fi

if [[ "$UPGRADE_ONLY" == true && ! -f "$CONFIG_PATH" ]]; then
  echo "No existing UseJunction enrollment found at ${CONFIG_PATH}" >&2
  exit 1
fi
if [[ "$RESUME_ONLY" == true && ! -f "$CONFIG_PATH" ]]; then
  echo "Existing UseJunction enrollment not found at ${CONFIG_PATH}; resume cannot safely re-enroll this device." >&2
  exit 1
fi

# Only treat a version as installable when the control plane publishes it.
# The hardcoded 0.1.0 default must never silently pull an ancient GitHub build
# when the local admin has no agent-releases row.
HAS_PUBLISHED_RELEASE=false
LATEST_JSON="$(curl -fsSL "${CONTROL_PLANE_URL}/api/agent-releases/latest" 2>/dev/null || true)"
LATEST_VERSION="$(printf '%s' "$LATEST_JSON" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
if [[ "$LATEST_VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]]; then
  VERSION="$LATEST_VERSION"
  HAS_PUBLISHED_RELEASE=true
elif [[ "$UPGRADE_ONLY" == true ]]; then
  echo "No active agent release is available from ${CONTROL_PLANE_URL}." >&2
  exit 1
fi

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) ARCH="amd64" ;;
  arm64|aarch64) ARCH="arm64" ;;
esac

mkdir -p "$INSTALL_DIR"

shell_rc_has_usejunction_path() {
  local rc="$1"
  [[ -f "$rc" ]] || return 1
  grep -qF "${HOME_DIR}/bin" "$rc" 2>/dev/null || grep -qF "$PATH_MARKER" "$rc" 2>/dev/null
}

detect_shell_rc() {
  local shell_name="${SHELL##*/}"
  local rc=""
  case "$shell_name" in
    zsh) rc="${HOME}/.zshrc" ;;
    bash)
      if [[ "$OS" == "darwin" && -f "${HOME}/.bash_profile" && ! -f "${HOME}/.bashrc" ]]; then
        rc="${HOME}/.bash_profile"
      else
        rc="${HOME}/.bashrc"
      fi
      ;;
    fish) rc="${HOME}/.config/fish/config.fish" ;;
    *)
      if [[ -f "${HOME}/.zshrc" ]]; then
        rc="${HOME}/.zshrc"
      elif [[ -f "${HOME}/.bashrc" ]]; then
        rc="${HOME}/.bashrc"
      fi
      ;;
  esac
  if [[ -n "$rc" ]]; then
    printf '%s\n' "$rc"
  fi
}

ensure_cli_on_path() {
  local rc
  rc="$(detect_shell_rc || true)"
  if [[ -n "$rc" ]]; then
    if ! shell_rc_has_usejunction_path "$rc"; then
      mkdir -p "$(dirname "$rc")"
      if [[ "${SHELL##*/}" == "fish" ]]; then
        cat >>"$rc" <<EOF

${PATH_MARKER}
fish_add_path ${HOME_DIR}/bin
EOF
      else
        cat >>"$rc" <<EOF

${PATH_MARKER}
export PATH="${HOME_DIR}/bin:\$PATH"
EOF
      fi
      echo "Added UseJunction CLI to ${rc}"
    fi
  else
    echo "Could not detect a shell rc file; add ${HOME_DIR}/bin to your PATH manually."
  fi
  export PATH="$INSTALL_DIR:$PATH"
}

print_cli_instructions() {
  echo ""
  if [[ "$AGENT_PROFILE" == "test" ]]; then
    echo "UseJunction test agent installed. Admin panel: ${CONTROL_PLANE_URL}"
  else
    echo "UseJunction installed. Admin panel: ${CONTROL_PLANE_URL}"
  fi
  echo "CLI: ${INSTALL_DIR}/${CLI_NAME}"
  echo "Next: open a new terminal, or run: export PATH=\"${INSTALL_DIR}:\$PATH\""
  echo "Then: ${CLI_NAME} status"
  echo "Rollback an update: ${CLI_NAME} update --rollback"
}

SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
ARCHIVE="usejunction-${OS}-${ARCH}"

agent_profile_args() {
  if [[ "$AGENT_PROFILE" == "test" ]]; then
    printf '%s\n' --profile test
  fi
}

write_dev_source_pin() {
  local root="$1"
  [[ -n "$root" && -f "${root}/agent/main.go" ]] || return 0
  mkdir -p "${HOME_DIR}"
  printf '%s\n' "$root" > "$DEV_SOURCE_FILE"
  echo "Pinned local checkout at ${DEV_SOURCE_FILE} → ${root}"
}

# Remember the monorepo root whenever we locate agent sources so packaging and
# later curl|install.sh runs keep using this checkout instead of a stale release.
remember_usejunction_root() {
  local agent_src="$1"
  local root
  root="$(cd "$(dirname "$agent_src")" 2>/dev/null && pwd || true)"
  [[ -n "$root" && -f "${root}/agent/main.go" ]] || return 0
  USEJUNCTION_ROOT="$root"
  export USEJUNCTION_ROOT
}

find_agent_src() {
  if [[ -n "${USEJUNCTION_ROOT:-}" && -f "${USEJUNCTION_ROOT}/agent/main.go" ]]; then
    remember_usejunction_root "${USEJUNCTION_ROOT}/agent"
    printf '%s\n' "${USEJUNCTION_ROOT}/agent"
    return 0
  fi
  if [[ -n "${SCRIPT_DIR:-}" && -f "${SCRIPT_DIR}/agent/main.go" ]]; then
    remember_usejunction_root "${SCRIPT_DIR}/agent"
    printf '%s\n' "${SCRIPT_DIR}/agent"
    return 0
  fi
  local dir="${PWD:-.}"
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/agent/main.go" ]]; then
      remember_usejunction_root "$dir/agent"
      printf '%s\n' "$dir/agent"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

download_agent() {
  local base="$1"
  local tmp_dir="$2"
  local archive="$3"
  curl -fsSL "${base}/${archive}" -o "${tmp_dir}/${archive}"
  curl -fsSL "${base}/checksums.txt" -o "${tmp_dir}/checksums.txt"
  local expected
  expected="$(awk -v name="$archive" '$2 == name {print $1}' "${tmp_dir}/checksums.txt")"
  [[ -n "$expected" ]] || { echo "Checksum for ${archive} not found in ${base}/checksums.txt"; return 1; }
  local actual
  if command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "${tmp_dir}/${archive}" | awk '{print $1}')"
  else
    actual="$(sha256sum "${tmp_dir}/${archive}" | awk '{print $1}')"
  fi
  [[ "$actual" == "$expected" ]] || { echo "Agent checksum verification failed"; return 1; }
  printf '%s\n' "${tmp_dir}/${archive}"
}

find_package_script() {
  if [[ -n "${USEJUNCTION_ROOT:-}" && -f "${USEJUNCTION_ROOT}/scripts/package-macos-app.sh" ]]; then
    printf '%s\n' "${USEJUNCTION_ROOT}/scripts/package-macos-app.sh"
    return 0
  fi
  if [[ -n "${SCRIPT_DIR:-}" && -f "${SCRIPT_DIR}/scripts/package-macos-app.sh" ]]; then
    printf '%s\n' "${SCRIPT_DIR}/scripts/package-macos-app.sh"
    return 0
  fi
  local dir="${PWD:-.}"
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/scripts/package-macos-app.sh" ]]; then
      printf '%s\n' "$dir/scripts/package-macos-app.sh"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

migrate_legacy_macos_app() {
  [[ -d "$LEGACY_APP_DIR" ]] || return 0
  if [[ -d "$APP_DIR" ]]; then
    rm -rf "$LEGACY_APP_DIR"
    return 0
  fi
  mv "$LEGACY_APP_DIR" "$APP_DIR"
}

install_macos_app_bundle() {
  local binary="$1"
  local package_script=""
  mkdir -p "$APPS_DIR"
  local staged_app="${APPS_DIR}/${APP_NAME}.new.app"
  rm -rf "$staged_app"
  if package_script="$(find_package_script)"; then
    bash "$package_script" "$binary" "$staged_app" "$VERSION"
    swap_macos_app "$staged_app"
    return 0
  fi

  local macos_assets=""
  if [[ -n "${USEJUNCTION_ROOT:-}" && -f "${USEJUNCTION_ROOT}/agent/macos/AppIcon.icns" ]]; then
    macos_assets="${USEJUNCTION_ROOT}/agent/macos"
  elif [[ -n "${SCRIPT_DIR:-}" && -f "${SCRIPT_DIR}/agent/macos/AppIcon.icns" ]]; then
    macos_assets="${SCRIPT_DIR}/agent/macos"
  else
    local dir="${PWD:-.}"
    while [[ "$dir" != "/" ]]; do
      if [[ -f "$dir/agent/macos/AppIcon.icns" ]]; then
        macos_assets="$dir/agent/macos"
        break
      fi
      dir="$(dirname "$dir")"
    done
  fi
  [[ -n "$macos_assets" ]] || { echo "macOS bundle assets not found"; return 1; }

  mkdir -p "${staged_app}/Contents/MacOS" "${staged_app}/Contents/Resources"
  cp "$binary" "${staged_app}/Contents/MacOS/usejunction"
  chmod +x "${staged_app}/Contents/MacOS/usejunction"
  cp "${macos_assets}/AppIcon.icns" "${staged_app}/Contents/Resources/AppIcon.icns"
  sed \
    -e "s/<string>0.1.0<\\/string>/<string>${VERSION}<\\/string>/g" \
    "${macos_assets}/Info.plist" > "${staged_app}/Contents/Info.plist"
  swap_macos_app "$staged_app"
}

swap_macos_app() {
  local staged_app="$1"
  local previous_app="${APPS_DIR}/${APP_NAME}.previous.app"
  mkdir -p "$APPS_DIR"
  migrate_legacy_macos_app
  rm -rf "$previous_app"
  if [[ -d "$APP_DIR" ]]; then
    mv "$APP_DIR" "$previous_app"
  fi
  if ! mv "$staged_app" "$APP_DIR"; then
    [[ -d "$previous_app" ]] && mv "$previous_app" "$APP_DIR"
    return 1
  fi
  remove_hidden_macos_app
}

link_macos_cli() {
  mkdir -p "$INSTALL_DIR"
  ln -sfn "${APP_DIR}/Contents/MacOS/usejunction" "${INSTALL_DIR}/${CLI_NAME}"
}

remove_hidden_macos_app() {
  [[ "$OS" == "darwin" ]] || return 0
  rm -rf "$HIDDEN_APP_DIR" \
    "${HOME_DIR}/${APP_NAME}.previous.app" \
    "${HOME_DIR}/${APP_NAME}.app.previous" \
    "$LEGACY_APP_DIR"
}

ensure_visible_macos_app() {
  [[ "$OS" == "darwin" ]] || return 0
  mkdir -p "$APPS_DIR"
  if [[ -x "${APP_DIR}/Contents/MacOS/usejunction" ]]; then
    BINARY="${APP_DIR}/Contents/MacOS/usejunction"
    remove_hidden_macos_app
    return 0
  fi
  if [[ -d "$HIDDEN_APP_DIR" ]]; then
    if [[ -d "$APP_DIR" ]]; then
      rm -rf "$HIDDEN_APP_DIR"
    else
      mv "$HIDDEN_APP_DIR" "$APP_DIR"
    fi
  fi
  if [[ -x "${APP_DIR}/Contents/MacOS/usejunction" ]]; then
    BINARY="${APP_DIR}/Contents/MacOS/usejunction"
  fi
}

write_launchd_plist() {
  PLIST="${HOME}/Library/LaunchAgents/${LAUNCHD_PLIST}"
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
    <string>${BINARY}</string>
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
    <string>${BINARY}</string>
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

download_macos_agent() {
  local base="$1"
  local tmp_dir="$2"
  local app_archive="${ARCHIVE}.app.zip"
  local app_path
  if app_path="$(download_agent "$base" "$tmp_dir" "$app_archive")"; then
    local extracted="${tmp_dir}/extracted"
    mkdir -p "$APPS_DIR"
    local staged_app="${APPS_DIR}/${APP_NAME}.new.app"
    rm -rf "$extracted" "$staged_app"
    mkdir -p "$extracted"
    ditto -x -k "$app_path" "$extracted"
    if [[ -x "${extracted}/${APP_NAME}.app/Contents/MacOS/usejunction" ]]; then
      ditto "${extracted}/${APP_NAME}.app" "$staged_app"
    elif [[ -x "${extracted}/UseJunction Agent.app/Contents/MacOS/usejunction" ]]; then
      ditto "${extracted}/UseJunction Agent.app" "$staged_app"
    else
      echo "App bundle missing executable"
      return 1
    fi
    swap_macos_app "$staged_app"
    link_macos_cli
    return 0
  fi
  return 1
}

installed_agent_binary() {
  if [[ "$OS" == "darwin" && -x "${APP_DIR}/Contents/MacOS/usejunction" ]]; then
    printf '%s\n' "${APP_DIR}/Contents/MacOS/usejunction"
    return 0
  fi
  if [[ "$OS" == "darwin" && -x "${HIDDEN_APP_DIR}/Contents/MacOS/usejunction" ]]; then
    printf '%s\n' "${HIDDEN_APP_DIR}/Contents/MacOS/usejunction"
    return 0
  fi
  if [[ -x "$BINARY" ]]; then
    printf '%s\n' "$BINARY"
    return 0
  fi
  return 1
}

current_agent_version() {
  local bin="$1"
  local json
  json="$("$bin" status --format json 2>/dev/null || true)"
  printf '%s' "$json" | sed -n 's/.*"agentVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
}

is_local_dev_version() {
  local version="$1"
  [[ "$version" == 0.0.0-dev.* || "$version" == v0.0.0-dev.* ]]
}

dev_build_version() {
  local root="${USEJUNCTION_ROOT:-}"
  local short_sha="nogit"
  if [[ -n "$root" ]] && command -v git >/dev/null 2>&1; then
    short_sha="$(git -C "$root" rev-parse --short HEAD 2>/dev/null || echo nogit)"
  fi
  printf '0.0.0-dev.%s.%s\n' "$short_sha" "$(date +%s)"
}

build_agent_from_source() {
  local agent_src stamp_version
  agent_src="$(find_agent_src)" || return 1
  if ! command -v go >/dev/null 2>&1; then
    return 1
  fi
  stamp_version="$(dev_build_version)"
  echo "Building agent from source (${agent_src}) as v${stamp_version}..."
  if [[ "$OS" == "darwin" ]]; then
    local tmp_binary
    tmp_binary="$(mktemp)"
    (cd "$agent_src" && go build -ldflags "-X github.com/usejunction/agent/internal/config.Version=${stamp_version}" -o "$tmp_binary" .)
    VERSION="$stamp_version"
    install_macos_app_bundle "$tmp_binary"
    rm -f "$tmp_binary"
    link_macos_cli
    write_dev_source_pin "${USEJUNCTION_ROOT:-}"
    return 0
  fi
  local tmp_binary
  tmp_binary="$(mktemp "${INSTALL_DIR}/.usejunction-build.XXXXXX")"
  (cd "$agent_src" && go build -ldflags "-X github.com/usejunction/agent/internal/config.Version=${stamp_version}" -o "$tmp_binary" .)
  VERSION="$stamp_version"
  atomic_install_binary "$tmp_binary" "$BINARY"
  write_dev_source_pin "${USEJUNCTION_ROOT:-}"
  return 0
}

install_agent() {
  local agent_src=""
  local prefer_source=false
  local stamp_version="$VERSION"
  local allow_release_download=false

  if [[ "$HAS_PUBLISHED_RELEASE" == true ]] || [[ "$FORCE_RELEASE" == "1" ]]; then
    allow_release_download=true
  fi

  # Prefer a local checkout whenever:
  # - USEJUNCTION_ROOT / BUILD_FROM_SOURCE is set (dev pin / injected by local admin)
  # - the control plane has no published agent release (typical localhost)
  # - install is running against a loopback control plane and source is available
  if [[ "${USEJUNCTION_BUILD_FROM_SOURCE:-}" == "1" ]] || [[ -n "${USEJUNCTION_ROOT:-}" && -f "${USEJUNCTION_ROOT}/agent/main.go" ]]; then
    prefer_source=true
  elif [[ "$HAS_PUBLISHED_RELEASE" != true ]] && [[ "$FORCE_RELEASE" != "1" ]]; then
    prefer_source=true
  elif is_local_control_plane && [[ "$FORCE_RELEASE" != "1" ]]; then
    prefer_source=true
  fi

  if [[ "$prefer_source" == true ]] && build_agent_from_source; then
    return 0
  fi

  # Pinned dev checkout always rebuilds — never enroll/onboard on a stale binary.
  if [[ -f "$DEV_SOURCE_FILE" ]] && build_agent_from_source; then
    return 0
  fi

  # Keep an existing local-dev binary unless the caller forces a release install.
  local existing=""
  if existing="$(installed_agent_binary)"; then
    local current_version
    current_version="$(current_agent_version "$existing")"
    if is_local_dev_version "$current_version" && [[ "$FORCE_RELEASE" != "1" ]]; then
      echo "Keeping local agent v${current_version} (pinned by pnpm agent:reinstall / 0.0.0-dev)."
      echo "Set USEJUNCTION_FORCE_RELEASE=1 to download a published release over it."
      VERSION="$current_version"
      if [[ "$OS" == "darwin" ]]; then
        link_macos_cli
      fi
      return 0
    fi
  fi

  # Never invent GitHub agent-v0.1.0 when this control plane has no release.
  # That binary is the legacy gateway-era build and breaks local observability.
  if [[ "$allow_release_download" != true ]]; then
    echo "No active agent release is published on ${CONTROL_PLANE_URL}, and no local checkout was available to build from." >&2
    echo "Customers download published releases from the control plane; local/dev installs must build from source." >&2
    echo "Fix options:" >&2
    echo "  1. From this repo:  ./install.sh --token <token> --url ${CONTROL_PLANE_URL}" >&2
    echo "  2. Or: USEJUNCTION_ROOT=/path/to/usejunction curl -fsSL ${CONTROL_PLANE_URL}/install.sh | sh -s -- --token <token> --url ${CONTROL_PLANE_URL}" >&2
    echo "  3. Or enroll then: pnpm agent:reinstall" >&2
    echo "  4. Or publish an agent release on the control plane, then re-run install." >&2
    exit 1
  fi

  if [[ "$OS" == "darwin" ]]; then
    local tmp_dir
    tmp_dir="$(mktemp -d)"
    trap 'if [ -n "${tmp_dir:-}" ]; then rm -rf "$tmp_dir"; fi' EXIT

    local control_base="${CONTROL_PLANE_URL}/releases/download/v${VERSION}"
    local github_base="https://github.com/Dinuda/usejunction/releases/download/agent-v${VERSION}"
    local bases=()
    if [[ -n "${USEJUNCTION_DOWNLOAD_BASE:-}" ]]; then
      bases+=("${USEJUNCTION_DOWNLOAD_BASE}")
    fi
    bases+=("${control_base}" "${github_base}")

    local base
    for base in "${bases[@]}"; do
      echo "Downloading UseJunction agent ${VERSION} for ${OS}/${ARCH} from ${base}..."
      if download_macos_agent "$base" "$tmp_dir"; then
        return 0
      fi
      echo "App bundle download from ${base} failed; trying bare binary..."
      local binary_path
      if binary_path="$(download_agent "$base" "$tmp_dir" "$ARCHIVE")"; then
        install_macos_app_bundle "$binary_path"
        link_macos_cli
        return 0
      fi
      echo "Download from ${base} failed; trying next source..."
    done
  else
    local tmp_dir
    tmp_dir="$(mktemp -d)"
    trap 'if [ -n "${tmp_dir:-}" ]; then rm -rf "$tmp_dir"; fi' EXIT

    local control_base="${CONTROL_PLANE_URL}/releases/download/v${VERSION}"
    local github_base="https://github.com/Dinuda/usejunction/releases/download/agent-v${VERSION}"
    local bases=()
    if [[ -n "${USEJUNCTION_DOWNLOAD_BASE:-}" ]]; then
      bases+=("${USEJUNCTION_DOWNLOAD_BASE}")
    fi
    bases+=("${control_base}" "${github_base}")

    local base
    for base in "${bases[@]}"; do
      echo "Downloading UseJunction agent ${VERSION} for ${OS}/${ARCH} from ${base}..."
      local binary_path
      if binary_path="$(download_agent "$base" "$tmp_dir" "$ARCHIVE")"; then
        atomic_install_binary "$binary_path" "$BINARY"
        return 0
      fi
      echo "Download from ${base} failed; trying next source..."
    done
  fi

  echo "Could not install the UseJunction agent."
  echo "No prebuilt binary was found, and Go source was not available to build."
  echo "Fix options:"
  echo "  1. From a checkout:  ./install.sh --token <token> --url ${CONTROL_PLANE_URL}"
  echo "  2. Or: cd agent && go build -o ~/.usejunction/bin/usejunction ."
  echo "  3. Or set USEJUNCTION_ROOT to your repo and re-run this installer."
  exit 1
}

atomic_install_binary() {
  local source="$1"
  local destination="$2"
  local staged="${destination}.new"
  local previous="${destination}.previous"
  cp "$source" "$staged"
  chmod +x "$staged"
  rm -f "$previous"
  if [[ -e "$destination" ]]; then
    mv "$destination" "$previous"
  fi
  if ! mv "$staged" "$destination"; then
    [[ -e "$previous" ]] && mv "$previous" "$destination"
    return 1
  fi
}

semver_compare() {
  local left="$1" right="$2"
  local left_core="${left%%-*}" right_core="${right%%-*}"
  local left_pre="" right_pre=""
  [[ "$left" == *-* ]] && left_pre="${left#*-}"
  [[ "$right" == *-* ]] && right_pre="${right#*-}"
  local left_major left_minor left_patch right_major right_minor right_patch
  IFS=. read -r left_major left_minor left_patch <<< "$left_core"
  IFS=. read -r right_major right_minor right_patch <<< "$right_core"
  local left_number right_number
  for left_number in "$left_major" "$left_minor" "$left_patch"; do
    case "$left_number" in *[!0-9]*|'') return 2 ;; esac
  done
  for right_number in "$right_major" "$right_minor" "$right_patch"; do
    case "$right_number" in *[!0-9]*|'') return 2 ;; esac
  done
  local pair
  for pair in "${left_major}:${right_major}" "${left_minor}:${right_minor}" "${left_patch}:${right_patch}"; do
    left_number="${pair%%:*}"
    right_number="${pair#*:}"
    if ((10#$left_number > 10#$right_number)); then echo 1; return 0; fi
    if ((10#$left_number < 10#$right_number)); then echo -1; return 0; fi
  done
  if [[ -z "$left_pre" || -z "$right_pre" ]]; then
    if [[ -z "$left_pre" && -z "$right_pre" ]]; then echo 0
    elif [[ -z "$left_pre" ]]; then echo 1
    else echo -1
    fi
    return 0
  fi
  local left_parts right_parts
  IFS=. read -ra left_parts <<< "$left_pre"
  IFS=. read -ra right_parts <<< "$right_pre"
  local index=0 max_parts="${#left_parts[@]}"
  (( ${#right_parts[@]} > max_parts )) && max_parts="${#right_parts[@]}"
  while ((index < max_parts)); do
    if ((index >= ${#left_parts[@]})); then echo -1; return 0; fi
    if ((index >= ${#right_parts[@]})); then echo 1; return 0; fi
    local left_part="${left_parts[$index]}" right_part="${right_parts[$index]}"
    if [[ "$left_part" != "$right_part" ]]; then
      if [[ "$left_part" =~ ^[0-9]+$ && "$right_part" =~ ^[0-9]+$ ]]; then
        if ((10#$left_part > 10#$right_part)); then echo 1; else echo -1; fi
      elif [[ "$left_part" =~ ^[0-9]+$ ]]; then echo -1
      elif [[ "$right_part" =~ ^[0-9]+$ ]]; then echo 1
      elif [[ "$left_part" > "$right_part" ]]; then echo 1
      else echo -1
      fi
      return 0
    fi
    index=$((index + 1))
  done
  echo 0
}

if [[ "$UPGRADE_ONLY" == true && -x "$BINARY" ]]; then
  CURRENT_JSON="$("$BINARY" status --format json 2>/dev/null || true)"
  CURRENT_VERSION="$(printf '%s' "$CURRENT_JSON" | sed -n 's/.*"agentVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  if [[ -z "$CURRENT_VERSION" ]]; then
    echo "Could not determine the installed agent version; refusing an unverified upgrade." >&2
    exit 1
  fi
  if is_local_dev_version "$CURRENT_VERSION" && [[ "$FORCE_RELEASE" != "1" ]]; then
    echo "Refusing to replace local agent v${CURRENT_VERSION} with published v${VERSION}." >&2
    echo "Run pnpm agent:reinstall, or set USEJUNCTION_FORCE_RELEASE=1 to force a release install." >&2
    exit 1
  fi
  VERSION_ORDER="$(semver_compare "$VERSION" "$CURRENT_VERSION")" || {
    echo "Could not compare installed version ${CURRENT_VERSION} with release ${VERSION}." >&2
    exit 1
  }
  if [[ "$VERSION_ORDER" == "-1" ]]; then
    echo "Refusing to downgrade UseJunction from v${CURRENT_VERSION} to v${VERSION}." >&2
    exit 1
  fi
  if [[ "$VERSION_ORDER" == "0" ]]; then
    echo "UseJunction agent v${CURRENT_VERSION} is already installed."
    exit 0
  fi
fi

RESUME_EXISTING_BINARY=""
if [[ "$RESUME_ONLY" == true ]]; then
  RESUME_EXISTING_BINARY="$(installed_agent_binary 2>/dev/null || true)"
  if [[ -n "$RESUME_EXISTING_BINARY" && -x "$RESUME_EXISTING_BINARY" && "$HAS_PUBLISHED_RELEASE" == true ]]; then
    CURRENT_JSON="$($RESUME_EXISTING_BINARY status --format json 2>/dev/null || true)"
    CURRENT_VERSION="$(printf '%s' "$CURRENT_JSON" | sed -n 's/.*"agentVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
    if [[ -n "$CURRENT_VERSION" ]] && ! is_local_dev_version "$CURRENT_VERSION"; then
      VERSION_ORDER="$(semver_compare "$VERSION" "$CURRENT_VERSION" 2>/dev/null || true)"
      if [[ "$VERSION_ORDER" == "1" ]]; then
        echo "Refreshing the outdated agent from v${CURRENT_VERSION} to v${VERSION} for setup recovery."
        RESUME_EXISTING_BINARY=""
      fi
    fi
  fi
fi
if [[ -n "$RESUME_EXISTING_BINARY" ]]; then
  BINARY="$RESUME_EXISTING_BINARY"
  echo "Using existing UseJunction agent for setup recovery."
else
  install_agent
fi
if [[ "$OS" == "darwin" ]]; then
  ensure_visible_macos_app
  BINARY="${APP_DIR}/Contents/MacOS/usejunction"
  link_macos_cli
else
  chmod +x "$BINARY"
fi
ensure_cli_on_path

if [[ "$UPGRADE_ONLY" == true ]]; then
  echo "Restarting existing background agent…"
  if [[ "$OS" == "darwin" ]]; then
    write_launchd_plist
    PLIST="${HOME}/Library/LaunchAgents/${LAUNCHD_PLIST}"
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST"
    launchctl kickstart -k "gui/$(id -u)/${LAUNCHD_LABEL}" 2>/dev/null || true
  elif [[ "$OS" == "linux" ]] && command -v systemctl >/dev/null 2>&1; then
    systemctl --user daemon-reload
    systemctl --user restart "${SYSTEMD_UNIT}"
  fi
  # shellcheck disable=SC2046
  "$BINARY" $(agent_profile_args) status
  echo "UseJunction agent upgraded to v${VERSION}."
  echo "CLI: ${INSTALL_DIR}/${CLI_NAME}"
  echo "Next: open a new terminal, or run: export PATH=\"${INSTALL_DIR}:\$PATH\""
  exit 0
fi

RESUME_FAILED=false
RESUME_AUTH_FAILED=false
ONBOARD_FAILED=false
if [[ "$RESUME_ONLY" == true ]]; then
  echo "Resuming UseJunction setup from the existing enrollment…"
  # shellcheck disable=SC2046
  SETUP_OUTPUT="$("$BINARY" $(agent_profile_args) setup 2>&1)" || RESUME_FAILED=true
  printf '%s\n' "$SETUP_OUTPUT"
  if [[ "$RESUME_FAILED" == true ]]; then
    if printf '%s' "$SETUP_OUTPUT" | grep -qi 'unauthorized\|credentials were revoked'; then
      RESUME_AUTH_FAILED=true
      echo "This device was removed or decommissioned on the control plane." >&2
      echo "Remove ${HOME_DIR} and enroll again with a fresh token from the dashboard (do not use --resume)." >&2
    else
      echo "Initial sync is still incomplete; the background agent will keep retrying." >&2
    fi
  fi
else
  # shellcheck disable=SC2046
  if ! "$BINARY" $(agent_profile_args) onboard --token "$ENROLL_TOKEN" --url "$CONTROL_PLANE_URL" --accept-collection-notice; then
    if [[ ! -f "$CONFIG_PATH" ]]; then
      echo "Device onboarding failed before enrollment completed." >&2
      exit 1
    fi
    ONBOARD_FAILED=true
    echo "Device enrolled, but the first sync did not complete. The background agent will keep retrying." >&2
  fi
fi

# macOS launchd user agent
if [[ "$OS" == "darwin" ]]; then
  write_launchd_plist
  PLIST="${HOME}/Library/LaunchAgents/${LAUNCHD_PLIST}"
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "  ✓ Background agent  running (launchd)"
fi

# Linux systemd user service
if [[ "$OS" == "linux" ]] && command -v systemctl >/dev/null 2>&1; then
  UNIT_DIR="${HOME}/.config/systemd/user"
  mkdir -p "$UNIT_DIR"
  if [[ "$AGENT_PROFILE" == "test" ]]; then
    EXEC_START="${BINARY} --profile test daemon"
  else
    EXEC_START="${BINARY} daemon"
  fi
  cat > "$UNIT_DIR/${SYSTEMD_UNIT}" <<EOF
[Unit]
Description=UseJunction Agent (${AGENT_PROFILE})
After=network.target

[Service]
ExecStart=${EXEC_START}
Restart=always
RestartSec=30

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now "${SYSTEMD_UNIT}"
  echo "  ✓ Background agent  running (systemd)"
fi

if [[ "$RESUME_ONLY" == true ]]; then
  # shellcheck disable=SC2046
  "$BINARY" $(agent_profile_args) status
  if [[ "$RESUME_FAILED" == true ]]; then
    if [[ "$RESUME_AUTH_FAILED" == true ]]; then
      echo "UseJunction setup recovery cannot continue with revoked credentials." >&2
    else
      echo "UseJunction setup recovery did not complete. Re-run this resume command after checking your network." >&2
    fi
    exit 1
  fi
  echo "UseJunction setup resumed successfully."
  exit 0
fi

if [[ "$ONBOARD_FAILED" == true ]]; then
  echo "UseJunction was installed, but setup is incomplete." >&2
  echo "Retry with: curl -fsSL ${CONTROL_PLANE_URL}/install.sh | sh -s -- --resume --url ${CONTROL_PLANE_URL}" >&2
  exit 1
fi

# shellcheck disable=SC2046
"$BINARY" $(agent_profile_args) onboard --complete
