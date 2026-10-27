#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/.github/security/tool-versions.env"
if [[ -z "${REPORT_DIR:-}" ]]; then
  echo "REPORT_DIR is required" >&2
  exit 1
fi
mkdir -p "$REPORT_DIR/zap"
chmod 0777 "$REPORT_DIR/zap"
status() {
  node "$ROOT/.github/security/scripts/write-status.mjs" zap-baseline "$1" "$2"
}

target=""
if [[ -f "$REPORT_DIR/target-url.txt" ]]; then
  target="$(tr -d '[:space:]' <"$REPORT_DIR/target-url.txt")"
fi
if [[ ! "$target" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^[:space:]]*)?$ ]]; then
  status failed "ZAP target is missing or is not a plain https URL. No scan was guessed."
  exit 0
fi
case "$target" in
  *"@"*|*"?"*|*"#"*)
    status failed "ZAP target must not include credentials, a query string, or a fragment."
    exit 0
    ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  status failed "Docker is not available, so the OWASP ZAP baseline did not run."
  exit 0
fi

if ! docker pull "$ZAP_IMAGE" >"$REPORT_DIR/zap-pull.log" 2>&1; then
  status failed "Could not pull the pinned ZAP image."
  exit 0
fi

set +e
docker run --rm \
  -v "$REPORT_DIR/zap:/zap/wrk:rw" \
  -w /zap/wrk \
  "$ZAP_IMAGE" \
  zap-baseline.py \
    -t "$target" \
    -J zap.json \
    -m 1 \
    -T 10 \
    -I \
    -s \
    -z "-config spider.maxDepth=2 -config spider.thread=2 -config spider.postForm=false -config start.checkForUpdates=false" \
  >"$REPORT_DIR/zap.stdout" 2>"$REPORT_DIR/zap.stderr"
code=$?
set -e

if [[ ! -s "$REPORT_DIR/zap/zap.json" ]]; then
  status failed "ZAP baseline did not write a JSON report (exit ${code}). This is not a clean result for the deployed site."
  exit 0
fi

status completed "ZAP baseline finished against ${target} (exit ${code}). Passive rules only. Spider depth 2, one minute, two threads, form posts off. Active and authenticated scans were not run."
exit 0
