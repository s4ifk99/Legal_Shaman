#!/usr/bin/env bash
# Download pinned gitleaks and osv-scanner binaries and verify their checksums.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/.github/security/tool-versions.env"

DEST="${1:-${SCANNER_BIN:-}}"
if [[ -z "$DEST" ]]; then
  echo "Pass a destination directory or set SCANNER_BIN." >&2
  exit 1
fi
mkdir -p "$DEST"

archive="$DEST/$GITLEAKS_ARCHIVE"
curl -fsSL -o "$archive" "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${GITLEAKS_ARCHIVE}"
echo "${GITLEAKS_SHA256}  ${archive}" | sha256sum -c -
tar -xzf "$archive" -C "$DEST" gitleaks
rm -f "$archive"

curl -fsSL -o "$DEST/osv-scanner" "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/${OSV_SCANNER_BINARY}"
echo "${OSV_SCANNER_SHA256}  ${DEST}/osv-scanner" | sha256sum -c -
chmod 0755 "$DEST/gitleaks" "$DEST/osv-scanner"

"$DEST/gitleaks" version
"$DEST/osv-scanner" --version
echo "Pinned scanners installed in $DEST"
