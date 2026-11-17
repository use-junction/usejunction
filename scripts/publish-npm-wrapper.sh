#!/usr/bin/env bash
# Publishes npm/usejunction as `usejunction@<version>`, so `npx usejunction`
# runs that agent release.
#
#   scripts/publish-npm-wrapper.sh 0.4.21 --dry-run   # show what would be published
#   scripts/publish-npm-wrapper.sh 0.4.21             # publish (needs npm login or NODE_AUTH_TOKEN)
#
# The package holds no binary. It downloads the release's binary on first run,
# so the release must be published before the package is. It does hold the
# release's checksums.txt, so the binary is checked against what was published
# here rather than against a file served next to it.
#
# Publishing a version that is already on npm is skipped, so the release
# workflow can be run again safely. In GitHub Actions it publishes with npm
# provenance, which ties the package to the workflow run that built it.
set -euo pipefail

VERSION="${1:-}"
MODE="${2:-}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || [[ -n "$MODE" && "$MODE" != "--dry-run" ]]; then
  echo "Usage: $0 <version> [--dry-run]   (version like 0.4.21)" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="https://github.com/use-junction/usejunction/releases/download/agent-v${VERSION}"

# A package that points at a release nobody can download is broken for everyone.
if ! CHECKSUMS="$(curl -fsSL "${BASE}/checksums.txt")"; then
  echo "Release agent-v${VERSION} is not published (no checksums.txt at ${BASE})." >&2
  exit 1
fi
for asset in usejunction-darwin-arm64 usejunction-darwin-amd64 usejunction-linux-arm64 usejunction-linux-amd64 usejunction-windows-amd64.exe usejunction-windows-arm64.exe; do
  if ! awk -v name="$asset" '$2 == name { found = 1 } END { exit !found }' <<<"$CHECKSUMS"; then
    echo "Release agent-v${VERSION} has no ${asset}." >&2
    exit 1
  fi
done

if [[ "$MODE" != "--dry-run" ]] && [[ "$(npm view "usejunction@${VERSION}" version 2>/dev/null || true)" == "$VERSION" ]]; then
  echo "usejunction@${VERSION} is already on npm; nothing to publish."
  exit 0
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$ROOT/npm/usejunction/." "$STAGE/"
rm -rf "$STAGE/docs"
cp "$ROOT/LICENSE" "$STAGE/LICENSE"
printf '%s\n' "$CHECKSUMS" > "$STAGE/checksums.txt"

PUBLISH=(npm publish --access public)
if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  PUBLISH+=(--provenance)
fi
if [[ "$MODE" == "--dry-run" ]]; then
  PUBLISH+=(--dry-run)
fi
(
  cd "$STAGE"
  npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null
  "${PUBLISH[@]}"
)
