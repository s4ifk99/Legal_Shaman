import assert from "node:assert/strict"
import test from "node:test"
import { cvssV3Score, severityFromNumber, severityFromSignals } from "./severity.mjs"

test("numeric CVSS bands match the scan thresholds", () => {
  assert.equal(severityFromNumber(9), "critical")
  assert.equal(severityFromNumber(8.9), "high")
  assert.equal(severityFromNumber(7), "high")
  assert.equal(severityFromNumber(6.9), "medium")
  assert.equal(severityFromNumber(4), "medium")
  assert.equal(severityFromNumber(3.9), "low")
})

test("known CVSS v3 vectors score correctly", () => {
  assert.equal(cvssV3Score("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"), 9.8)
  assert.equal(cvssV3Score("CVSS:3.1/AV:A/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N"), 8.1)
  assert.equal(cvssV3Score("CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N"), 0)
})

test("the highest signal wins and a missing score fails closed", () => {
  assert.equal(severityFromSignals(["LOW", "9.1"]).severity, "critical")
  assert.equal(severityFromSignals(["moderate"]).severity, "medium")
  assert.equal(severityFromSignals(["CVSS:3.1/AV:A/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N"]).severity, "high")
  const missing = severityFromSignals([""])
  assert.equal(missing.severity, "high")
  assert.equal(missing.unparsed, true)
})
