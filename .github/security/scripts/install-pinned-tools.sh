#!/usr/bin/env bash
# Download pinned gitleaks and osv-scanner binaries and verify their checksums.
set -euo pipefail

dest="${1:?install directory required}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# shellcheck disable=SC1091
source "$root/.github/security/tool-versions.env"

mkdir -p "$dest"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl --fail --location --silent --show-error --retry 3 --proto '=https' --tlsv1.2 \
  --output "$tmp/gitleaks.tar.gz" \
  "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
echo "${GITLEAKS_SHA256}  $tmp/gitleaks.tar.gz" | sha256sum -c -
tar -xzf "$tmp/gitleaks.tar.gz" -C "$dest" gitleaks
chmod 755 "$dest/gitleaks"

curl --fail --location --silent --show-error --retry 3 --proto '=https' --tlsv1.2 \
  --output "$tmp/osv-scanner" \
  "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_amd64"
echo "${OSV_SCANNER_SHA256}  $tmp/osv-scanner" | sha256sum -c -
install -m 755 "$tmp/osv-scanner" "$dest/osv-scanner"

"$dest/gitleaks" version >/dev/null
"$dest/osv-scanner" --version >/dev/null
