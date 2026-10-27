#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
if [[ -z "${REPORT_DIR:-}" ]]; then
  echo "REPORT_DIR is required" >&2
  exit 1
fi
mkdir -p "$REPORT_DIR"
status() {
  node "$ROOT/.github/security/scripts/write-status.mjs" npm-audit "$1" "$2"
}

set +e
npm audit --json --package-lock-only --prefix "$ROOT/web" >"$REPORT_DIR/npm-audit.json" 2>"$REPORT_DIR/npm-audit.stderr"
code=$?
set -e

if [[ ! -s "$REPORT_DIR/npm-audit.json" ]]; then
  status failed "npm audit did not write a JSON report (exit ${code})."
  exit 0
fi

if node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!d.vulnerabilities && d.error) process.exit(2);' "$REPORT_DIR/npm-audit.json"; then
  if [[ "$code" -eq 0 || "$code" -eq 1 ]]; then
    status completed "npm audit finished (exit ${code}). Severity is taken from the JSON report. Fixes were not applied."
  else
    status failed "npm audit exited ${code} with an unexpected status."
  fi
else
  status failed "npm audit JSON was an error payload (exit ${code})."
fi
exit 0
