#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/.github/security/tool-versions.env"
if [[ -z "${REPORT_DIR:-}" ]]; then
  echo "REPORT_DIR is required" >&2
  exit 1
fi
mkdir -p "$REPORT_DIR/sanitized"
status() {
  node "$ROOT/.github/security/scripts/write-status.mjs" semgrep "$1" "$2"
}

if [[ -n "${SEMGREP_APP_TOKEN:-}" ]]; then
  status failed "SEMGREP_APP_TOKEN is set. Refusing to run Semgrep because that token can send code to Semgrep Cloud."
  exit 0
fi
unset SEMGREP_APP_TOKEN || true

if ! command -v docker >/dev/null 2>&1; then
  status failed "Docker is not available, so the pinned Semgrep image did not run."
  exit 0
fi

if ! docker pull "$SEMGREP_IMAGE" >"$REPORT_DIR/semgrep-pull.log" 2>&1; then
  status failed "Could not pull the pinned Semgrep image."
  exit 0
fi

raw="$REPORT_DIR/semgrep.raw.json"
set +e
docker run --rm \
  -v "$ROOT:/src:ro" \
  -v "$REPORT_DIR:/out" \
  -e SEMGREP_SEND_METRICS=off \
  -e SEMGREP_ENABLE_VERSION_CHECK=0 \
  -e HOME=/tmp \
  "$SEMGREP_IMAGE" \
  semgrep scan \
    --metrics=off \
    --disable-version-check \
    --config p/default \
    --config p/owasp-top-ten \
    --config p/nextjs \
    --config p/react \
    --config p/nodejs \
    --config /src/.github/security/semgrep/legalshaman.yml \
    --json \
    --output /out/semgrep.raw.json \
    --timeout 20 \
    --max-target-bytes 1000000 \
    /src \
  >"$REPORT_DIR/semgrep.stdout" 2>"$REPORT_DIR/semgrep.stderr"
code=$?
set -e

if [[ ! -s "$raw" ]]; then
  status failed "Semgrep did not write a JSON report (exit ${code})."
  exit 0
fi

if ! node "$ROOT/.github/security/scripts/sanitize-semgrep.mjs" "$raw" "$REPORT_DIR/sanitized/semgrep.json"; then
  rm -f "$raw"
  status failed "Semgrep report could not be sanitized. The raw report was deleted and was not uploaded."
  exit 0
fi

if [[ "$code" -eq 0 || "$code" -eq 1 ]]; then
  status completed "Semgrep ${SEMGREP_VERSION} finished locally (exit ${code}). Metrics were off. Semgrep Cloud was not used."
else
  status failed "Semgrep exited ${code}. Any partial sanitized findings were kept, but this scanner did not finish cleanly."
fi
exit 0
