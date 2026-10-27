#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
if [[ -z "${REPORT_DIR:-}" ]]; then
  echo "REPORT_DIR is required" >&2
  exit 1
fi
mkdir -p "$REPORT_DIR/publish"
date_stamp="$(tr -d '[:space:]' <"$REPORT_DIR/report-date.txt")"
out="$REPORT_DIR/publish/security-report-${date_stamp}.tar.gz.enc"

mark() {
  node "$ROOT/.github/security/scripts/update-report-storage.mjs" "$1" "${2:-}"
}

ready() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "ready=$1" >>"$GITHUB_OUTPUT"
  fi
}

if [[ -z "${SECURITY_SCAN_REPORT_KEY:-}" ]]; then
  mark false "SECURITY_SCAN_REPORT_KEY is not set. Refusing to upload a plaintext report from a public repository."
  ready false
  exit 0
fi

mark true "Encrypted artifact created."
tar -czf "$REPORT_DIR/report.tar.gz" -C "$REPORT_DIR" report.json report.md
if ! openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -pass env:SECURITY_SCAN_REPORT_KEY \
  -in "$REPORT_DIR/report.tar.gz" \
  -out "$out"; then
  rm -f "$REPORT_DIR/report.tar.gz" "$out"
  mark false "Encryption failed. The plaintext report was deleted and was not uploaded."
  ready false
  exit 0
fi
rm -f "$REPORT_DIR/report.tar.gz"
ready true
echo "Encrypted report written."
exit 0
