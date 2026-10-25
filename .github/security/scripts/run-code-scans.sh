#!/usr/bin/env bash
# Dependency, secret, and static scans. Does not modify the tree or call scanner fix commands.
set -euo pipefail

ROOT="$(cd "${1:-.}" && pwd)"
REPORT_DIR="$(mkdir -p "${2:?report dir}" && cd "${2}" && pwd)"
TOOL_DIR="${3:-/tmp/legalshaman-security-tools}"
export PATH="${HOME}/.local/bin:${PATH}"

git -C "$ROOT" rev-parse HEAD > "$REPORT_DIR/commit.txt"
node "$ROOT/.github/security/scripts/resolve-target-url.mjs" "$ROOT" > "$REPORT_DIR/target.json"
node "$ROOT/.github/security/scripts/custom-checks.mjs" "$ROOT" "$REPORT_DIR/custom-checks.json"

set +e
"$TOOL_DIR/gitleaks" detect \
  --no-git \
  --source "$ROOT" \
  --redact=100 \
  --no-banner \
  --log-level error \
  --config "$ROOT/.github/security/gitleaks.toml" \
  --report-format json \
  --report-path "$REPORT_DIR/gitleaks.json" \
  --exit-code 1
echo $? > "$REPORT_DIR/gitleaks.exit"
set -e
if [[ ! -f "$REPORT_DIR/gitleaks.json" ]]; then
  echo "[]" > "$REPORT_DIR/gitleaks.json"
fi

export SEMGREP_SEND_METRICS=off
export SEMGREP_ENABLE_VERSION_CHECK=0
unset SEMGREP_APP_TOKEN || true
set +e
semgrep scan \
  --metrics=off \
  --disable-version-check \
  --quiet \
  --json \
  --output "$REPORT_DIR/semgrep.json" \
  --config "$ROOT/.github/security/semgrep/legalshaman.yml" \
  --config p/javascript \
  --config p/typescript \
  --config p/nextjs \
  --config p/nodejs \
  --config p/owasp-top-ten \
  --exclude node_modules \
  --exclude web/data \
  --exclude .next \
  --exclude .git \
  --exclude security-reports \
  --timeout 20 \
  --jobs 2 \
  "$ROOT"
echo $? > "$REPORT_DIR/semgrep.exit"
set -e

set +e
(cd "$ROOT/web" && npm audit --json > "$REPORT_DIR/npm-audit.json")
echo $? > "$REPORT_DIR/npm-audit.exit"
set -e

set +e
"$TOOL_DIR/osv-scanner" scan source --format json --output-file "$REPORT_DIR/osv-npm.json" -L "$ROOT/web/package-lock.json"
echo $? > "$REPORT_DIR/osv-npm.exit"
"$TOOL_DIR/osv-scanner" scan source --format json --output-file "$REPORT_DIR/osv-python.json" -L "$ROOT/scripts/exa/requirements-exa.txt"
echo $? > "$REPORT_DIR/osv-python.exit"
set -e
