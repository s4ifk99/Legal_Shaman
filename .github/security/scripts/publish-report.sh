#!/usr/bin/env bash
# Encrypt the report directory. Refuse to leave a plaintext archive behind.
set -euo pipefail

REPORT_DIR="$(cd "${1:?report dir}" && pwd)"
OUT_DIR="$(mkdir -p "${2:?output dir}" && cd "${2}" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "${SECURITY_SCAN_REPORT_KEY:-}" ]]; then
  echo "SECURITY_SCAN_REPORT_KEY is unset. Refusing to write a plaintext archive."
  exit 2
fi

LONDON_DAY="$(node "$SCRIPT_DIR/london-schedule-gate.mjs" --manual | awk -F= '/^london_day=/{print $2}')"
if [[ -z "$LONDON_DAY" ]]; then
  LONDON_DAY="$(date -u +%F)"
fi

STAGE="$(mktemp -d)"
tar -C "$REPORT_DIR" -czf "$STAGE/report.tar.gz" .
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -pass env:SECURITY_SCAN_REPORT_KEY \
  -in "$STAGE/report.tar.gz" \
  -out "$OUT_DIR/legalshaman-security-scan-${LONDON_DAY}.tar.gz.enc"
rm -rf "$STAGE"
echo "encrypted=$OUT_DIR/legalshaman-security-scan-${LONDON_DAY}.tar.gz.enc"
