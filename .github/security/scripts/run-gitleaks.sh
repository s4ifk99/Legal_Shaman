#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
if [[ -z "${REPORT_DIR:-}" || -z "${SCANNER_BIN:-}" ]]; then
  echo "REPORT_DIR and SCANNER_BIN are required" >&2
  exit 1
fi
mkdir -p "$REPORT_DIR/sanitized"
status() {
  node "$ROOT/.github/security/scripts/write-status.mjs" gitleaks "$1" "$2"
}

raw="$REPORT_DIR/gitleaks.raw.json"
set +e
"$SCANNER_BIN/gitleaks" detect \
  --source "$ROOT" \
  --config "$ROOT/.github/security/gitleaks.toml" \
  --redact=100 \
  --no-banner \
  --no-color \
  --log-level error \
  --max-target-megabytes 2 \
  --report-format json \
  --report-path "$raw" \
  --exit-code 2 \
  --log-opts="HEAD" \
  >"$REPORT_DIR/gitleaks.stdout" 2>"$REPORT_DIR/gitleaks.stderr"
code=$?
set -e

if [[ "$code" -ne 0 && "$code" -ne 2 ]]; then
  rm -f "$raw"
  status failed "gitleaks failed before a usable report (exit ${code})."
  exit 0
fi

if [[ ! -f "$raw" ]]; then
  printf '[]\n' >"$raw"
fi

if ! node "$ROOT/.github/security/scripts/sanitize-gitleaks.mjs" "$raw" "$REPORT_DIR/sanitized/gitleaks.json"; then
  rm -f "$raw"
  status failed "gitleaks report could not be sanitized. The raw report was deleted and was not uploaded."
  exit 0
fi

status completed "gitleaks finished (exit ${code}). Secret values were removed from the report. History from HEAD was scanned. Other branches, data/, web/data/, and files over 2 MB were skipped."
exit 0
