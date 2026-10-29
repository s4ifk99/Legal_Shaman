#!/usr/bin/env bash
# Run the daily scanners against a git archive of TARGET_DIR HEAD.
# Writes a report to OUT_DIR. Does not modify the repository.
set -euo pipefail

TARGET_DIR="${TARGET_DIR:?TARGET_DIR is required}"
SCANNER_DIR="${SCANNER_DIR:?SCANNER_DIR is required}"
OUT_DIR="${OUT_DIR:?OUT_DIR is required}"
SCRIPTS="${SCANNER_DIR}/scripts"

set -a
# shellcheck disable=SC1091
source "${SCANNER_DIR}/versions.env"
set +a

mkdir -p "${OUT_DIR}/tools" "${OUT_DIR}/logs"
TREE="${OUT_DIR}/source-tree"
rm -rf "${TREE}"
mkdir -p "${TREE}"

git -C "${TARGET_DIR}" archive --format=tar HEAD | tar -x -C "${TREE}"
SCAN_SHA="$(git -C "${TARGET_DIR}" rev-parse HEAD)"
export SCAN_SHA

write_meta() {
  local name="$1"
  local code="$2"
  local errfile="$3"
  node "${SCRIPTS}/write-meta.mjs" "${name}" "${code}" "${errfile}" "${OUT_DIR}/${name}.meta.json"
}

download() {
  local url="$1"
  local dest="$2"
  local sum="$3"
  curl -fsSL -o "${dest}" "${url}"
  echo "${sum}  ${dest}" | sha256sum -c -
}

install_gitleaks() {
  local archive="${OUT_DIR}/tools/gitleaks.tar.gz"
  download \
    "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
    "${archive}" \
    "${GITLEAKS_SHA256}"
  tar -xzf "${archive}" -C "${OUT_DIR}/tools" gitleaks
  chmod +x "${OUT_DIR}/tools/gitleaks"
}

install_osv() {
  local bin="${OUT_DIR}/tools/osv-scanner"
  download \
    "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_amd64" \
    "${bin}" \
    "${OSV_SCANNER_SHA256}"
  chmod +x "${bin}"
}

run_npm() {
  local err="${OUT_DIR}/logs/npm-audit.stderr"
  local code=0
  if [[ ! -f "${TREE}/web/package-lock.json" ]]; then
    echo "web/package-lock.json is missing from the archive" >"${err}"
    write_meta npm-audit 2 "${err}"
    return
  fi
  set +e
  (
    cd "${TREE}/web"
    npm audit --json --package-lock-only >"${OUT_DIR}/npm-audit.json" 2>"${err}"
  )
  code=$?
  set -e
  write_meta npm-audit "${code}" "${err}"
}

run_osv() {
  local err="${OUT_DIR}/logs/osv-scanner.stderr"
  local code=0
  if ! install_osv; then
    echo "osv-scanner checksum or download failed" >"${err}"
    write_meta osv-scanner 2 "${err}"
    return
  fi
  local args=()
  if [[ -f "${TREE}/web/package-lock.json" ]]; then
    args+=(-L "${TREE}/web/package-lock.json")
  fi
  if [[ -f "${TREE}/scripts/exa/requirements-exa.txt" ]]; then
    cp "${TREE}/scripts/exa/requirements-exa.txt" "${TREE}/scripts/exa/requirements.txt"
    args+=(-L "${TREE}/scripts/exa/requirements.txt")
  fi
  if [[ ${#args[@]} -eq 0 ]]; then
    echo "No lockfiles found" >"${err}"
    write_meta osv-scanner 2 "${err}"
    return
  fi
  set +e
  "${OUT_DIR}/tools/osv-scanner" scan source "${args[@]}" --format json --output-file "${OUT_DIR}/osv.json" --verbosity error >"${OUT_DIR}/logs/osv-scanner.stdout" 2>"${err}"
  code=$?
  set -e
  write_meta osv-scanner "${code}" "${err}"
}

run_gitleaks() {
  local err="${OUT_DIR}/logs/gitleaks.stderr"
  local code=0
  if ! install_gitleaks; then
    echo "gitleaks checksum or download failed" >"${err}"
    write_meta gitleaks 2 "${err}"
    return
  fi
  set +e
  "${OUT_DIR}/tools/gitleaks" dir "${TREE}" \
    --no-banner \
    --no-color \
    --log-level error \
    --redact=100 \
    --max-target-megabytes 2 \
    --config "${SCANNER_DIR}/gitleaks.toml" \
    --report-format json \
    --report-path "${OUT_DIR}/gitleaks.json" \
    >"${OUT_DIR}/logs/gitleaks.stdout" 2>"${err}"
  code=$?
  set -e
  if [[ ! -f "${OUT_DIR}/gitleaks.json" ]]; then
    echo "[]" >"${OUT_DIR}/gitleaks.json"
  fi
  write_meta gitleaks "${code}" "${err}"
}

run_app() {
  local err="${OUT_DIR}/logs/app-security-checks.stderr"
  local code=0
  set +e
  node "${SCRIPTS}/app-security-checks.mjs" "${TREE}" >"${OUT_DIR}/app-checks.json" 2>"${err}"
  code=$?
  set -e
  write_meta app-security-checks "${code}" "${err}"
}

run_semgrep() {
  local err="${OUT_DIR}/logs/semgrep.stderr"
  mkdir -p "${OUT_DIR}/semgrep-out"
  if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    echo "Docker is not available, so the pinned Semgrep image did not run." >"${err}"
    write_meta semgrep 2 "${err}"
    return
  fi
  local code=0
  set +e
  timeout 25m docker run --rm \
    --network=bridge \
    -e SEMGREP_SEND_METRICS=off \
    -e SEMGREP_ENABLE_VERSION_CHECK=0 \
    -e HOME=/tmp \
    -e XDG_CACHE_HOME=/tmp \
    -v "${TREE}:/src:ro" \
    -v "${SCANNER_DIR}/semgrep:/rules:ro" \
    -v "${OUT_DIR}/semgrep-out:/out" \
    --entrypoint semgrep \
    "${SEMGREP_IMAGE}" \
    scan \
    --metrics=off \
    --disable-version-check \
    --json \
    --output /out/semgrep.json \
    --config /rules/legalshaman.yml \
    --config p/javascript \
    --config p/typescript \
    --config p/react \
    --config p/nodejs \
    --config p/owasp-top-ten \
    --exclude data \
    --exclude web/data \
    --exclude node_modules \
    --exclude package-lock.json \
    --exclude "*.bin" \
    --timeout 30 \
    --timeout-threshold 20 \
    /src \
    >"${OUT_DIR}/logs/semgrep.stdout" 2>"${err}"
  code=$?
  set -e
  if [[ -f "${OUT_DIR}/semgrep-out/semgrep.json" ]]; then
    cp "${OUT_DIR}/semgrep-out/semgrep.json" "${OUT_DIR}/semgrep.json"
  fi
  write_meta semgrep "${code}" "${err}"
}

run_zap() {
  local err="${OUT_DIR}/logs/zap-baseline.stderr"
  local target=""
  if ! target="$(node "${SCRIPTS}/resolve-zap-target.mjs" "${TREE}" 2>"${err}")"; then
    write_meta zap-baseline 2 "${err}"
    return
  fi
  if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    echo "ZAP target resolved to ${target}. Docker is not available, so the pinned OWASP ZAP baseline image did not run." >"${err}"
    write_meta zap-baseline 2 "${err}"
    return
  fi
  mkdir -p "${OUT_DIR}/zap-wrk"
  chmod 777 "${OUT_DIR}/zap-wrk"
  local code=0
  set +e
  timeout 30m docker run --rm \
    --network=bridge \
    -v "${OUT_DIR}/zap-wrk:/zap/wrk:rw" \
    --entrypoint zap-baseline.py \
    "${ZAP_IMAGE}" \
    -t "${target}" \
    -J zap.json \
    -r zap.html \
    -I \
    -m 5 \
    -T 20 \
    -z "-config spider.postForm=false -config spider.maxDepth=4 -config spider.thread=2 -config connection.timeoutInSecs=20" \
    >"${OUT_DIR}/logs/zap-baseline.stdout" 2>"${err}"
  code=$?
  set -e
  if [[ -f "${OUT_DIR}/zap-wrk/zap.json" ]]; then
    cp "${OUT_DIR}/zap-wrk/zap.json" "${OUT_DIR}/zap.json"
  fi
  if [[ -f "${OUT_DIR}/zap-wrk/zap.html" ]]; then
    cp "${OUT_DIR}/zap-wrk/zap.html" "${OUT_DIR}/zap.html"
  fi
  write_meta zap-baseline "${code}" "${err}"
}

run_npm || echo "npm audit runner failed" >&2
run_osv || echo "osv-scanner runner failed" >&2
run_gitleaks || echo "gitleaks runner failed" >&2
run_app || echo "application check runner failed" >&2
run_semgrep || echo "Semgrep runner failed" >&2
run_zap || echo "ZAP runner failed" >&2

node "${SCRIPTS}/build-report.mjs" "${OUT_DIR}"
echo "Report written to ${OUT_DIR}/security-report.json"
