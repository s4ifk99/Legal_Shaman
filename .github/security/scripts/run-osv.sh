#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
if [[ -z "${REPORT_DIR:-}" || -z "${SCANNER_BIN:-}" ]]; then
  echo "REPORT_DIR and SCANNER_BIN are required" >&2
  exit 1
fi
mkdir -p "$REPORT_DIR"
status() {
  node "$ROOT/.github/security/scripts/write-status.mjs" osv-scanner "$1" "$2"
}

set +e
"$SCANNER_BIN/osv-scanner" scan source \
  --lockfile "$ROOT/web/package-lock.json" \
  --format json \
  --output-file "$REPORT_DIR/osv.json" \
  --data-source native \
  >"$REPORT_DIR/osv.stdout" 2>"$REPORT_DIR/osv.stderr"
code=$?
set -e

if [[ ! -s "$REPORT_DIR/osv.json" ]]; then
  status failed "OSV scanner did not write a JSON report (exit ${code})."
  exit 0
fi

if node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!Array.isArray(d.results)) process.exit(2);' "$REPORT_DIR/osv.json"; then
  if [[ "$code" -eq 0 || "$code" -eq 1 ]]; then
    status completed "OSV scanner finished (exit ${code}) against web/package-lock.json. osv-scanner fix was not run."
  else
    status failed "OSV scanner exited ${code}."
  fi
else
  status failed "OSV JSON did not contain results (exit ${code})."
fi
exit 0
