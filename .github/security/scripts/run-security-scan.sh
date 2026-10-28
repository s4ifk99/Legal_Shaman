#!/usr/bin/env bash
# Run the Legal Shaman security scan. Does not fix, commit, or deploy.
set -euo pipefail
umask 077

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/../../.." && pwd)
cd "$ROOT"
# shellcheck disable=SC1091
source "$ROOT/.github/security/versions.env"

OUT="$ROOT/.security-scan-out"
DATE=$(date -u +%Y-%m-%d)
RAW="$OUT/raw"
TREE="$OUT/tree"
TOOLS="$OUT/tools"
publish_failed=0
scan_code=2

rm -rf "$OUT"
mkdir -p "$RAW" "$OUT/upload" "$TOOLS" "$TREE"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "report_date=${DATE}" >> "$GITHUB_OUTPUT"
  echo "artifact_name=security-scan-${DATE}" >> "$GITHUB_OUTPUT"
fi

write_meta() {
  node --input-type=module -e 'import fs from "node:fs"; const [file,name,status,code,error]=process.argv.slice(1); fs.writeFileSync(file, JSON.stringify({name,status,exitCode:Number(code),error:error||null}));' \
    "$RAW/$1.meta.json" "$1" "$2" "$3" "$4"
}

redact_file_to_stdout() {
  node --input-type=module -e 'import fs from "node:fs"; import { redactText } from "./.github/security/scripts/redact.mjs"; process.stdout.write(redactText(fs.readFileSync(process.argv[1], "utf8")));' "$1"
}

classify_json_exit() {
  local code="$1" file="$2"
  if { [ "$code" -eq 0 ] || [ "$code" -eq 1 ]; } && [ -s "$file" ]; then
    printf 'completed'
  else
    printf 'failed'
  fi
}

download_verified() {
  local url="$1" dest="$2" sha="$3"
  curl -fsSL "$url" -o "$dest"
  echo "${sha}  ${dest}" | sha256sum -c -
}

cleanup_plaintext() {
  rm -rf "$RAW" "$TREE" "$TOOLS"
  rm -f "$OUT/report.json" "$OUT/report.md" "$OUT/report.tar.gz" "$OUT/public-summary.md" "$OUT/exit-code"
}

finish() {
  trap - EXIT
  if [ ! -f "$OUT/public-summary.md" ]; then
    printf '%s\n' "# Daily security scan" "" "Scan conclusion: INCOMPLETE" "The scan script stopped before it could write a report. This is not a clean result." "" > "$OUT/public-summary.md"
  fi
  if [ -f "$OUT/public-summary.md" ] && grep -q "Publish: pending" "$OUT/public-summary.md"; then
    publish_failed=1
    sed -i 's/Publish: pending/Publish: not published. The plaintext report was deleted and was not uploaded./' "$OUT/public-summary.md"
  fi
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    cat "$OUT/public-summary.md" >> "$GITHUB_STEP_SUMMARY"
  fi
  cat "$OUT/public-summary.md"
  cleanup_plaintext
  if [ "$publish_failed" -eq 1 ] && [ "$scan_code" -eq 0 ]; then
    exit 3
  fi
  exit "$scan_code"
}
trap finish EXIT

echo "Running scan script unit tests"
set +e
node --test "$ROOT/.github/security/scripts/"*.test.mjs >"$RAW/script-tests.log" 2>&1
test_code=$?
set -e
if [ "$test_code" -eq 0 ]; then
  write_meta script-tests completed 0 ""
  echo '{}' > "$RAW/script-tests.json"
else
  write_meta script-tests failed "$test_code" "Unit tests for the scan scripts failed."
  echo "Unit test output (redacted):"
  redact_file_to_stdout "$RAW/script-tests.log" || true
  echo
fi
rm -f "$RAW/script-tests.log"

if [ -z "${SCAN_REF:-}" ]; then
  SCAN_REF=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || true)
  SCAN_REF=${SCAN_REF#origin/}
  SCAN_REF=${SCAN_REF:-main}
fi

echo "Fetching ${SCAN_REF} for the scan tree"
fetch_ok=0
if git fetch --no-tags --depth=1 origin "$SCAN_REF" >/dev/null 2>&1; then
  fetch_ok=1
fi

tree_ok=0
commit=""
if [ "$fetch_ok" -eq 1 ]; then
  commit=$(git rev-parse FETCH_HEAD)
  short=${commit:0:7}
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "artifact_name=security-scan-${DATE}-${short}" >> "$GITHUB_OUTPUT"
  fi
  if git archive --format=tar FETCH_HEAD -- . ':(exclude)data' ':(exclude)web/data' | tar -x -C "$TREE"; then
    tree_ok=1
  fi
fi

target_url=""
target_error=""
if [ "$tree_ok" -eq 1 ]; then
  set +e
  target_url=$(node "$ROOT/.github/security/scripts/resolve-zap-target.mjs" "$TREE" 2>"$RAW/target.err")
  target_code=$?
  set -e
  if [ "$target_code" -ne 0 ]; then
    target_url=""
    target_error=$(redact_file_to_stdout "$RAW/target.err" | tr '\n' ' ' | cut -c1-500)
  fi
  rm -f "$RAW/target.err"
else
  target_error="The default branch tree could not be fetched, so no scanner that reads source was run."
fi

node --input-type=module -e 'import fs from "node:fs"; const [file,commit,ref,url,error]=process.argv.slice(1); fs.writeFileSync(file, JSON.stringify({commit:commit||null,ref:ref||null,targetUrl:url||null,targetError:error||null}));' \
  "$RAW/source.meta.json" "$commit" "$SCAN_REF" "$target_url" "$target_error"

if [ "$tree_ok" -ne 1 ]; then
  for name in npm-audit osv gitleaks semgrep-local semgrep-registry app-checks zap-baseline; do
    write_meta "$name" failed 1 "The default branch tree was not available."
  done
else
  echo "npm audit"
  set +e
  npm audit --json --package-lock-only --prefix "$TREE/web" >"$RAW/npm-audit.json" 2>"$RAW/npm-audit.err"
  npm_code=$?
  set -e
  npm_status=$(classify_json_exit "$npm_code" "$RAW/npm-audit.json")
  npm_error=""
  if [ "$npm_status" != "completed" ]; then
    npm_error="npm audit did not produce a JSON report (exit ${npm_code})."
  fi
  write_meta npm-audit "$npm_status" "$npm_code" "$npm_error"
  rm -f "$RAW/npm-audit.err"

  echo "osv-scanner"
  osv_bin="$TOOLS/osv-scanner"
  if download_verified \
    "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/${OSV_SCANNER_ASSET}" \
    "$osv_bin" \
    "$OSV_SCANNER_SHA256"
  then
    chmod +x "$osv_bin"
    set +e
    "$osv_bin" scan source --verbosity error --format json --output-file "$RAW/osv.json" \
      -L "$TREE/web/package-lock.json" \
      -L "$TREE/scripts/exa/requirements-exa.txt" >"$RAW/osv.log" 2>&1
    osv_code=$?
    set -e
    osv_status=$(classify_json_exit "$osv_code" "$RAW/osv.json")
    osv_error=""
    if [ "$osv_status" != "completed" ]; then
      osv_error="osv-scanner did not produce a JSON report (exit ${osv_code})."
    fi
    write_meta osv "$osv_status" "$osv_code" "$osv_error"
  else
    write_meta osv failed 1 "osv-scanner failed checksum verification and was not run."
  fi
  rm -f "$RAW/osv.log"

  echo "gitleaks"
  gitleaks_archive="$TOOLS/gitleaks.tar.gz"
  if download_verified \
    "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${GITLEAKS_ASSET}" \
    "$gitleaks_archive" \
    "$GITLEAKS_SHA256"
  then
    tar -xzf "$gitleaks_archive" -C "$TOOLS" gitleaks
    chmod +x "$TOOLS/gitleaks"
    set +e
    "$TOOLS/gitleaks" detect \
      --no-git \
      --no-banner \
      --redact=100 \
      --source "$TREE" \
      --config "$ROOT/.github/security/gitleaks.toml" \
      --report-format json \
      --report-path "$RAW/gitleaks.json" \
      --max-target-megabytes 2 >"$RAW/gitleaks.log" 2>&1
    gitleaks_code=$?
    set -e
    if [ ! -s "$RAW/gitleaks.json" ]; then
      echo '[]' > "$RAW/gitleaks.json"
    fi
    gitleaks_status=$(classify_json_exit "$gitleaks_code" "$RAW/gitleaks.json")
    gitleaks_error=""
    if [ "$gitleaks_status" != "completed" ]; then
      gitleaks_error="gitleaks did not produce a JSON report (exit ${gitleaks_code})."
    fi
    write_meta gitleaks "$gitleaks_status" "$gitleaks_code" "$gitleaks_error"
  else
    write_meta gitleaks failed 1 "gitleaks failed checksum verification and was not run."
  fi
  rm -f "$RAW/gitleaks.log" "$gitleaks_archive"

  run_semgrep() {
    local name="$1"
    shift
    local outfile="/out/${name}.json"
    if ! command -v docker >/dev/null 2>&1; then
      write_meta "$name" failed 127 "Docker is not available, so Semgrep did not run."
      return
    fi
    set +e
    docker run --rm --entrypoint sh \
      -e SEMGREP_SEND_METRICS=off \
      -e SEMGREP_ENABLE_VERSION_CHECK=0 \
      -e HOME=/tmp \
      -v "$TREE:/src:ro" \
      -v "$RAW:/out:rw" \
      -v "$ROOT/.github/security/semgrep:/rules:ro" \
      "$SEMGREP_IMAGE" \
      -c "$* --output ${outfile}; code=\$?; chmod a+r ${outfile} 2>/dev/null || true; exit \$code" \
      >"$RAW/${name}.log" 2>&1
    local code=$?
    set -e
    local status
    status=$(classify_json_exit "$code" "$RAW/${name}.json")
    local error=""
    if [ "$status" != "completed" ]; then
      error="Semgrep did not produce a JSON report (exit ${code})."
    fi
    write_meta "$name" "$status" "$code" "$error"
    rm -f "$RAW/${name}.log"
  }

  semgrep_flags="semgrep scan --metrics=off --disable-version-check --no-autofix --no-git-ignore --quiet --json --timeout 20 --timeout-threshold 10 --max-target-bytes 1000000 --exclude data --exclude web/data --exclude node_modules --exclude .security-scan-out --exclude .github/security/scripts --exclude .github/security/semgrep"
  echo "semgrep local rules"
  run_semgrep semgrep-local "$semgrep_flags --config /rules /src"
  echo "semgrep registry rules"
  run_semgrep semgrep-registry "$semgrep_flags --config p/owasp-top-ten --config p/javascript --config p/typescript --config p/nextjs --config p/nodejs --config p/react /src"

  echo "application checks"
  set +e
  node "$ROOT/.github/security/scripts/app-security-checks.mjs" --root "$TREE" --out "$RAW/app-checks.json" >"$RAW/app-checks.log" 2>&1
  app_code=$?
  set -e
  app_status=$(classify_json_exit "$app_code" "$RAW/app-checks.json")
  app_error=""
  if [ "$app_status" != "completed" ]; then
    app_error="Application checks did not produce a JSON report (exit ${app_code})."
  fi
  write_meta app-checks "$app_status" "$app_code" "$app_error"
  rm -f "$RAW/app-checks.log"

  echo "OWASP ZAP baseline"
  if [ -z "$target_url" ]; then
    write_meta zap-baseline failed 2 "${target_error:-The site URL could not be determined. No target was guessed.}"
  elif ! command -v docker >/dev/null 2>&1; then
    write_meta zap-baseline failed 127 "Docker is not available, so the OWASP ZAP baseline did not run."
  else
    mkdir -p "$RAW/zap-work"
    chmod 777 "$RAW/zap-work"
    set +e
    timeout 20m docker run --rm \
      -v "$RAW/zap-work:/zap/wrk:rw" \
      "$ZAP_IMAGE" \
      zap-baseline.py -t "$target_url" -J zap.json -m 1 -T 10 -I -s \
      >"$RAW/zap.log" 2>&1
    zap_code=$?
    set -e
    if [ -f "$RAW/zap-work/zap.json" ]; then
      mv "$RAW/zap-work/zap.json" "$RAW/zap-baseline.json"
    fi
    zap_status=$(classify_json_exit "$zap_code" "$RAW/zap-baseline.json")
    # Baseline exits 1 for high alerts and 2 for warnings. A report still counts as completed.
    if [ -s "$RAW/zap-baseline.json" ] && { [ "$zap_code" -eq 0 ] || [ "$zap_code" -eq 1 ] || [ "$zap_code" -eq 2 ]; }; then
      zap_status=completed
    fi
    zap_error=""
    if [ "$zap_status" != "completed" ]; then
      zap_error="OWASP ZAP baseline did not produce a JSON report (exit ${zap_code})."
    fi
    write_meta zap-baseline "$zap_status" "$zap_code" "$zap_error"
    rm -f "$RAW/zap.log" "$RAW/zap.yaml"
  fi
fi

echo "Writing the report"
node "$ROOT/.github/security/scripts/aggregate-report.mjs" --raw "$RAW" --out "$OUT" --tree "$TREE"
scan_code=$(cat "$OUT/exit-code")

publish_note="not published because SECURITY_SCAN_REPORT_KEY is not set. Plaintext was not uploaded."
publish_failed=1
if [ -n "${SECURITY_SCAN_REPORT_KEY:-}" ]; then
  publish_failed=0
  publish_note="encrypted report uploaded as a workflow artifact with 14 day retention."
fi
python3 - "$OUT/public-summary.md" "$publish_note" <<'PY'
import pathlib, sys
file, note = sys.argv[1], sys.argv[2]
path = pathlib.Path(file)
path.write_text(path.read_text().replace("Publish: pending", f"Publish: {note}"))
PY
if [ "$publish_failed" -eq 0 ]; then
  archive="$OUT/upload/security-scan-${DATE}${commit:+-${commit:0:7}}.tar.gz.enc"
  if ! tar -C "$OUT" -czf "$OUT/report.tar.gz" report.json report.md public-summary.md \
    || ! openssl enc -aes-256-cbc -pbkdf2 -md sha256 -iter 600000 -salt \
      -in "$OUT/report.tar.gz" \
      -out "$archive" \
      -pass env:SECURITY_SCAN_REPORT_KEY
  then
    publish_failed=1
    rm -f "$archive"
    python3 - "$OUT/public-summary.md" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text().replace(
    "encrypted report uploaded as a workflow artifact with 14 day retention.",
    "not published because encryption failed. Plaintext was not uploaded.",
)
path.write_text(text)
PY
  fi
fi

exit 0
