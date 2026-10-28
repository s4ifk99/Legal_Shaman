import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const workflow = fs.readFileSync(path.join(root, ".github/workflows/daily-security-scan.yml"), "utf8")
const runner = fs.readFileSync(path.join(root, ".github/security/scripts/run-security-scan.sh"), "utf8")
const allowlist = fs.readFileSync(path.join(root, ".github/security/gitleaks.toml"), "utf8")
const analytics = fs.readFileSync(path.join(root, "web/components/analytics/ahrefs-analytics.tsx"), "utf8")

test("the workflow is a manual and London-gated schedule with read-only permissions", () => {
  assert.match(workflow, /cron: "0 1 \* \* \*"/)
  assert.match(workflow, /cron: "0 2 \* \* \*"/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /pull_request:/)
  assert.match(workflow, /contents: read/)
  assert.match(workflow, /persist-credentials: false/)
  assert.match(workflow, /retention-days: 14/)
  assert.match(workflow, /SECURITY_SCAN_REPORT_KEY/)
  assert.match(workflow, /github\.event\.repository\.default_branch/)
})

test("the runner does not autofix, actively scan, or upload plaintext", () => {
  assert.match(runner, /--no-autofix/)
  assert.match(runner, /--metrics=off/)
  assert.match(runner, /zap-baseline\.py/)
  assert.match(runner, /SECURITY_SCAN_REPORT_KEY/)
  assert.doesNotMatch(runner, /semgrep ci/)
  assert.doesNotMatch(runner, /npm audit fix/)
  assert.doesNotMatch(runner, /osv-scanner fix/)
  assert.doesNotMatch(runner, /zap-full-scan/)
  assert.doesNotMatch(runner, /zap-api-scan/)
  assert.doesNotMatch(workflow, /semgrep ci/)
  assert.doesNotMatch(workflow, /npm audit fix/)
})

test("the gitleaks allowlist is only the public analytics site key", () => {
  const key = analytics.match(/data-key="([^"]+)"/)?.[1]
  assert.ok(key)
  const regexes = [...allowlist.matchAll(/regexes\s*=\s*\[\s*'''([^']+)'''\s*\]/g)].map((match) => match[1])
  assert.deepEqual(regexes, [key])
  assert.equal(allowlist.includes("MEILISEARCH"), false)
})
