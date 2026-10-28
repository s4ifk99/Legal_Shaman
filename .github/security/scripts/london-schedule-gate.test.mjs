import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { evaluateSchedule, londonParts } from "./london-schedule-gate.mjs"

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "london-schedule-gate.mjs")

function hourAt(iso) {
  return londonParts(new Date(iso)).hour
}

test("GMT winter: 02:00 UTC is 02:00 London and runs", () => {
  assert.equal(hourAt("2026-01-15T02:00:00Z"), 2)
  assert.equal(evaluateSchedule({ eventName: "schedule", now: new Date("2026-01-15T02:00:00Z") }).proceed, true)
})

test("GMT winter: 01:00 UTC is 01:00 London and is skipped", () => {
  assert.equal(hourAt("2026-01-15T01:00:00Z"), 1)
  assert.equal(evaluateSchedule({ eventName: "schedule", now: new Date("2026-01-15T01:00:00Z") }).proceed, false)
})

test("BST summer: 01:00 UTC is 02:00 London and runs", () => {
  assert.equal(hourAt("2026-07-01T01:00:00Z"), 2)
  assert.equal(evaluateSchedule({ eventName: "schedule", now: new Date("2026-07-01T01:00:00Z") }).proceed, true)
})

test("BST summer: 02:00 UTC is 03:00 London and is skipped", () => {
  assert.equal(hourAt("2026-07-01T02:00:00Z"), 3)
  assert.equal(evaluateSchedule({ eventName: "schedule", now: new Date("2026-07-01T02:00:00Z") }).proceed, false)
})

test("spring forward 2026-03-29: 01:00 UTC is 02:00 BST", () => {
  assert.equal(hourAt("2026-03-29T00:30:00Z"), 0)
  assert.equal(hourAt("2026-03-29T01:00:00Z"), 2)
  assert.equal(evaluateSchedule({ eventName: "schedule", now: new Date("2026-03-29T01:00:00Z") }).proceed, true)
})

test("fall back 2026-10-25: 02:00 London happens at 02:00 UTC", () => {
  assert.equal(hourAt("2026-10-25T00:30:00Z"), 1)
  assert.equal(hourAt("2026-10-25T01:00:00Z"), 1)
  assert.equal(hourAt("2026-10-25T02:00:00Z"), 2)
  assert.equal(evaluateSchedule({ eventName: "schedule", now: new Date("2026-10-25T01:00:00Z") }).proceed, false)
  assert.equal(evaluateSchedule({ eventName: "schedule", now: new Date("2026-10-25T02:00:00Z") }).proceed, true)
})

test("manual runs ignore the clock", () => {
  assert.equal(evaluateSchedule({ eventName: "workflow_dispatch", now: new Date("2026-07-01T15:00:00Z") }).proceed, true)
})

test("the gate writes proceed for a scheduled summer run", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"))
  const output = path.join(dir, "github-output")
  const result = spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: "schedule",
      SECURITY_SCAN_NOW: "2026-07-01T01:00:00Z",
      GITHUB_OUTPUT: output,
    },
  })
  assert.equal(result.status, 0)
  assert.match(fs.readFileSync(output, "utf8"), /proceed=true/)
})
