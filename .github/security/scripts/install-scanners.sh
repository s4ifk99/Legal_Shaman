#!/usr/bin/env bash
# Install pinned scanner binaries. Checksums are the release asset hashes.
set -euo pipefail

TOOL_DIR="${1:-/tmp/legalshaman-security-tools}"
mkdir -p "$TOOL_DIR"

GITLEAKS_VERSION="8.30.1"
GITLEAKS_SHA="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
OSV_VERSION="2.7.0"
OSV_SHA="160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b"
SEMGREP_VERSION="1.182.0"

if [[ ! -x "$TOOL_DIR/gitleaks" ]]; then
  curl -fsSL -o "$TOOL_DIR/gitleaks.tar.gz" \
    "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
  echo "${GITLEAKS_SHA}  ${TOOL_DIR}/gitleaks.tar.gz" | sha256sum -c -
  tar -xzf "$TOOL_DIR/gitleaks.tar.gz" -C "$TOOL_DIR" gitleaks
fi

if [[ ! -x "$TOOL_DIR/osv-scanner" ]]; then
  curl -fsSL -o "$TOOL_DIR/osv-scanner" \
    "https://github.com/google/osv-scanner/releases/download/v${OSV_VERSION}/osv-scanner_linux_amd64"
  echo "${OSV_SHA}  ${TOOL_DIR}/osv-scanner" | sha256sum -c -
  chmod 0755 "$TOOL_DIR/osv-scanner"
fi

python3 -m pip install --user --disable-pip-version-check "semgrep==${SEMGREP_VERSION}"
if [[ -n "${GITHUB_PATH:-}" ]]; then
  echo "${HOME}/.local/bin" >> "$GITHUB_PATH"
fi
export PATH="${HOME}/.local/bin:${PATH}"
"$TOOL_DIR/gitleaks" version
"$TOOL_DIR/osv-scanner" --version
semgrep --version
