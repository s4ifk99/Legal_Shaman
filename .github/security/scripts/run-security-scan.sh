#!/usr/bin/env bash
# Run the daily security scanners and write an encrypted report when the key is set.
# Scanner failures are recorded. This script exits 0 after recording a result so the
# workflow can upload the encrypted report before marking the run as failed.
set -euo pipefail
umask 077

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
scripts="$root/.github/security/scripts"
# shellcheck disable=SC1091
source "$root/.github/security/tool-versions.env"

scan_root="${SCAN_ROOT:-$root}"
if [[ -n "${SECURITY_SCAN_OUT:-}" ]]; then
  out="$SECURITY_SCAN_OUT"
elif [[ -n "${RUNNER_TEMP:-}" ]]; then
  out="${RUNNER_TEMP}/legalshaman-security-scan"
else
  out="$(mktemp -d /tmp/legalshaman-security-scan.XXXXXX)"
fi
case "$out" in
  *legalshaman-security-scan*) ;;
  *)
    echo "Refusing to use output directory outside legalshaman-security-scan" >&2
    exit 1
    ;;
esac
rm -rf "$out"
mkdir -p "$out/raw/status" "$out/report" "$out/bin" "$out/upload"
raw="$out/raw"

cd "$root"
node --test "$scripts"/security.test.mjs

bash "$scripts/install-pinned-tools.sh" "$out/bin"
export PATH="$out/bin:${PATH}"
unset SEMGREP_APP_TOKEN || true

write_status() {
  local id="$1" status="$2" detail="$3" private_file="${4:-}"
  shift $(( $# < 4 ? $# : 4 ))
  local args=(node "$scripts/write-status.mjs" --id "$id" --status "$status" --detail "$detail" --out "$raw/status/${id}.json")
  if [[ -n "$private_file" && -f "$private_file" ]]; then
    node "$scripts/redact-tail.mjs" "$private_file" "$private_file.redacted"
    args+=(--private-detail-file "$private_file.redacted")
  fi
  while [[ $# -gt 0 ]]; do
    args+=(--note "$1")
    shift
  done
  "${args[@]}"
}

cd "$scan_root"

# Dependency advisories. npm and OSV receive package names and versions, not source or user data.
set +e
npm audit --json --prefix web >"$raw/npm-audit.json" 2>"$raw/npm-audit.stderr"
npm_ec=$?
set -e
if node -e 'const doc=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!doc || typeof doc!=="object") process.exit(1);' "$raw/npm-audit.json" >/dev/null 2>&1; then
  write_status npm-audit completed "npm audit finished with exit ${npm_ec}. Advisory lookup used the npm registry." "$raw/npm-audit.stderr"
else
  write_status npm-audit failed "npm audit did not produce JSON (exit ${npm_ec})." "$raw/npm-audit.stderr"
fi

set +e
osv-scanner scan source \
  --lockfile "$scan_root/web/package-lock.json" \
  --lockfile "$scan_root/scripts/exa/requirements-exa.txt" \
  --format json \
  --output-file "$raw/osv.json" \
  >"$raw/osv.stdout" 2>"$raw/osv.stderr"
osv_ec=$?
set -e
if node -e 'const doc=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!Array.isArray(doc.results)) process.exit(1);' "$raw/osv.json" >/dev/null 2>&1; then
  write_status osv-scanner completed "osv-scanner finished with exit ${osv_ec}. Package names and versions were sent to the OSV API. Source code was not uploaded." "$raw/osv.stderr" \
    "Python requirements are scanned from scripts/exa/requirements-exa.txt. There is no hashed Python lockfile."
else
  write_status osv-scanner failed "osv-scanner did not produce a results report (exit ${osv_ec})." "$raw/osv.stderr"
fi

# Secret scanning. Values are redacted before the report is built.
set +e
gitleaks detect \
  --source "$scan_root" \
  --config "$root/.github/security/gitleaks.toml" \
  --redact \
  --no-banner \
  --log-level error \
  --max-target-megabytes "$GITLEAKS_MAX_TARGET_MB" \
  --report-format json \
  --report-path "$raw/gitleaks.json" \
  --exit-code 1 \
  >"$raw/gitleaks.stdout" 2>"$raw/gitleaks.stderr"
gitleaks_ec=$?
set -e
if [[ ! -s "$raw/gitleaks.json" && ( "$gitleaks_ec" -eq 0 || "$gitleaks_ec" -eq 1 ) ]]; then
  echo '[]' >"$raw/gitleaks.json"
fi
if [[ "$gitleaks_ec" -eq 0 || "$gitleaks_ec" -eq 1 ]] && node "$scripts/redact-gitleaks-file.mjs" "$raw/gitleaks.json"; then
  write_status gitleaks completed "gitleaks finished with exit ${gitleaks_ec}. Secret values were removed from the report." "$raw/gitleaks.stderr" \
    "Gitleaks skips web/data and any file larger than ${GITLEAKS_MAX_TARGET_MB} MB, including older copies of those files in git history."
else
  write_status gitleaks failed "gitleaks did not finish a redacted report (exit ${gitleaks_ec})." "$raw/gitleaks.stderr" \
    "Gitleaks skips web/data and any file larger than ${GITLEAKS_MAX_TARGET_MB} MB."
fi

# Current generated data: filenames only, never the matching line.
data_note="The current web/data tree is checked for a short list of key patterns. This does not replace a full secret scan of generated catalogues."
if [[ -d "$scan_root/web/data" ]]; then
  set +e
  grep -R -l -I -E \
    -e 'AKIA[0-9A-Z]{16}' \
    -e 'sk_live_[0-9A-Za-z]{10,}' \
    -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' \
    -e 'ghp_[A-Za-z0-9]{20,}' \
    -e 'github_pat_[A-Za-z0-9_]{20,}' \
    "$scan_root/web/data" >"$raw/data-pattern-files.txt" 2>"$raw/data-patterns.stderr"
  data_ec=$?
  set -e
  if [[ "$data_ec" -eq 0 || "$data_ec" -eq 1 ]]; then
    node --input-type=module -e 'import { readFileSync, writeFileSync } from "node:fs"; const files=readFileSync(process.argv[1],"utf8").split(/\n/).map((line)=>line.trim()).filter(Boolean); writeFileSync(process.argv[2], JSON.stringify({ files }));' \
      "$raw/data-pattern-files.txt" "$raw/data-patterns.json"
    write_status data-patterns completed "Pattern scan exit ${data_ec}. Matching lines were not copied." "" "$data_note"
  else
    echo '{"files":[]}' >"$raw/data-patterns.json"
    write_status data-patterns failed "Pattern scan could not read web/data (exit ${data_ec})." "$raw/data-patterns.stderr" "$data_note"
  fi
else
  echo '{"files":[]}' >"$raw/data-patterns.json"
  write_status data-patterns completed "web/data is not in this checkout." "" "$data_note"
fi

if node "$scripts/app-security-checks.mjs" "$scan_root" "$raw/app-checks.json"; then
  write_status app-security-checks completed "Application checks finished."
else
  echo '{"scanner":"app-security-checks","status":"failed","findings":[]}' >"$raw/app-checks.json"
  write_status app-security-checks failed "Application checks exited non-zero."
fi

semgrep_targets=()
for rel in web/app web/lib web/components web/scripts web/middleware.ts web/next.config.mjs scripts static-site .github/workflows; do
  if [[ -e "$scan_root/$rel" ]]; then
    semgrep_targets+=("/src/$rel")
  fi
done
if ! command -v docker >/dev/null 2>&1; then
  echo '{"results":[]}' >"$raw/semgrep.json"
  write_status semgrep failed "Docker is not available, so the pinned Semgrep image did not run."
  echo '{"site":[]}' >"$raw/zap.json"
  write_status zap failed "Docker is not available, so the OWASP ZAP baseline did not run."
else
  set +e
  docker pull "$SEMGREP_IMAGE" >"$raw/semgrep-pull.stdout" 2>"$raw/semgrep-pull.stderr"
  pull_ec=$?
  set -e
  if [[ "$pull_ec" -ne 0 ]]; then
    echo '{"results":[]}' >"$raw/semgrep.json"
    write_status semgrep failed "Could not pull the pinned Semgrep image." "$raw/semgrep-pull.stderr"
  else
    set +e
    docker run --rm \
      -v "$scan_root:/src:ro" \
      -e SEMGREP_SEND_METRICS=off \
      -e SEMGREP_ENABLE_VERSION_CHECK=0 \
      -e SEMGREP_APP_TOKEN= \
      "$SEMGREP_IMAGE" \
      semgrep scan \
        --metrics=off \
        --disable-version-check \
        --config p/javascript \
        --config p/typescript \
        --config p/nextjs \
        --config p/nodejs \
        --config p/react \
        --config p/owasp-top-ten \
        --config p/security-audit \
        --config p/python \
        --config p/github-actions \
        --config /src/.github/security/semgrep \
        --exclude web/data \
        --exclude node_modules \
        --exclude .next \
        --json \
        --quiet \
        "${semgrep_targets[@]}" \
      >"$raw/semgrep.json" 2>"$raw/semgrep.stderr"
    semgrep_ec=$?
    set -e
    if node -e 'const doc=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!Array.isArray(doc.results)) process.exit(1);' "$raw/semgrep.json" >/dev/null 2>&1 && [[ "$semgrep_ec" -lt 2 ]]; then
      write_status semgrep completed "Semgrep finished with exit ${semgrep_ec}. Metrics were off and no Semgrep Cloud token was set. Rule packs were downloaded. Source stayed on the runner." "$raw/semgrep.stderr" \
        "Semgrep does not scan web/data catalogues."
    else
      write_status semgrep failed "Semgrep did not finish a JSON report (exit ${semgrep_ec})." "$raw/semgrep.stderr" \
        "Semgrep does not scan web/data catalogues."
    fi
  fi

  target=""
  set +e
  target="$(node "$scripts/resolve-scan-target.mjs" "$scan_root" 2>"$raw/target.err")"
  target_ec=$?
  set -e
  if [[ "$target_ec" -ne 0 || -z "$target" ]]; then
    echo '{"site":[]}' >"$raw/zap.json"
    detail="$(tr '\n' ' ' <"$raw/target.err")"
    write_status zap failed "${detail:-The deployed URL could not be determined.}"
  else
    zap_work="$raw/zap-work"
    mkdir -p "$zap_work"
    chmod 777 "$zap_work"
    set +e
    docker pull "$ZAP_IMAGE" >"$raw/zap-pull.stdout" 2>"$raw/zap-pull.stderr"
    zap_pull=$?
    set -e
    if [[ "$zap_pull" -ne 0 ]]; then
      echo '{"site":[]}' >"$raw/zap.json"
      write_status zap failed "Could not pull the pinned ZAP image." "$raw/zap-pull.stderr"
    else
      set +e
      docker run --rm \
        -v "$zap_work:/zap/wrk:rw" \
        "$ZAP_IMAGE" \
        zap-baseline.py \
          -t "$target" \
          -J zap.json \
          -r zap.html \
          -w zap.md \
          -I \
          -m 2 \
          -T 10 \
          -z "-silent -config scanner.attackOnStart=false -config spider.postform=false" \
        >"$raw/zap.stdout" 2>"$raw/zap.stderr"
      zap_ec=$?
      set -e
      if [[ -f "$zap_work/zap.json" ]]; then
        cp "$zap_work/zap.json" "$raw/zap.json"
      fi
      # Exit 0, 1, and 2 are baseline outcomes. Exit 3 means the scan did not finish.
      if [[ -f "$raw/zap.json" && "$zap_ec" -ne 3 ]]; then
        write_status zap completed "ZAP baseline finished with exit ${zap_ec} against ${target}. Active scanner and form posting were disabled. No authentication was used." "$raw/zap.stdout" \
          "Baseline is a spider plus passive scan. It does not log in and it does not run an active attack."
      else
        echo '{"site":[]}' >"$raw/zap.json"
        write_status zap failed "ZAP baseline did not finish (exit ${zap_ec}) against ${target}." "$raw/zap.stdout"
      fi
    fi
  fi
fi

commit="${GITHUB_SHA:-}"
if [[ -z "$commit" ]]; then
  commit="$(git -C "$scan_root" rev-parse HEAD)"
fi
ref="${SCAN_REF:-${GITHUB_REF:-}}"
target_for_report=""
if [[ -f "$raw/status/zap.json" ]]; then
  target_for_report="$(node -e 'const doc=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const match=(doc.detail||"").match(/https:\/\/\S+/); if(match) process.stdout.write(match[0].replace(/[.,)]$/, ""));' "$raw/status/zap.json" 2>/dev/null || true)"
fi
if [[ -z "$target_for_report" ]]; then
  target_for_report="$(node "$scripts/resolve-scan-target.mjs" "$scan_root" 2>/dev/null || true)"
fi

result="$(node "$scripts/build-report.mjs" \
  --raw "$raw" \
  --out "$out/report" \
  --commit "$commit" \
  --ref "$ref" \
  --target "$target_for_report")"

london="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).londonDate)' "$out/report/security-report.json")"
artifact_ready=false
artifact_dir="$out/upload"
if [[ -n "${SECURITY_SCAN_REPORT_KEY:-}" ]]; then
  result="$(node "$scripts/build-report.mjs" --rewrite --out "$out/report" --artifact-stored true --artifact-detail "Encrypted artifact created.")"
  if tar -C "$out/report" -czf "$out/security-report.tar.gz" . \
    && openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
      -in "$out/security-report.tar.gz" \
      -out "$artifact_dir/security-report-${london}.tar.gz.enc" \
      -pass env:SECURITY_SCAN_REPORT_KEY
  then
    rm -f "$out/security-report.tar.gz"
    cat >"$artifact_dir/README.txt" <<EOF
Legal Shaman security report (encrypted)
London date: ${london}
Commit: ${commit}

GitHub Actions artifacts on a public repository are not a private store.
This file is encrypted with AES-256-CBC and PBKDF2 (200000 iterations).
Decrypt with the SECURITY_SCAN_REPORT_KEY repository secret:

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in security-report-${london}.tar.gz.enc -out security-report.tar.gz -pass env:SECURITY_SCAN_REPORT_KEY
tar -xzf security-report.tar.gz

security-report.md contains severity, location, redacted evidence, and a suggested fix.
This README does not contain findings.
EOF
    artifact_ready=true
  else
    rm -f "$out/security-report.tar.gz" "$artifact_dir"/security-report-*.tar.gz.enc
    result="$(node "$scripts/build-report.mjs" --rewrite --out "$out/report" --artifact-stored false --artifact-detail "The report could not be encrypted, so it was not uploaded.")"
    artifact_ready=false
  fi
else
  result="$(node "$scripts/build-report.mjs" --rewrite --out "$out/report" --artifact-stored false --artifact-detail "SECURITY_SCAN_REPORT_KEY is not set, so the report was not uploaded. Refusing to upload a plaintext report.")"
  rm -rf "$artifact_dir"
  mkdir -p "$artifact_dir"
  artifact_ready=false
fi

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  cat "$out/report/public-summary.md" >>"$GITHUB_STEP_SUMMARY"
fi
node -e 'const doc=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(doc.resultDetail + "\n");' "$out/report/security-report.json"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "artifact_ready=${artifact_ready}"
    echo "artifact_dir=${artifact_dir}"
    echo "conclusion=${result}"
  } >>"$GITHUB_OUTPUT"
fi
