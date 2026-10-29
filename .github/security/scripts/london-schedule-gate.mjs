import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function londonParts(date) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
  };
}

/** UTC instant of a Europe/London wall clock time. 02:00 exists on UK transition days. */
export function utcForLondonWallClock(year, month, day, hour, minute) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 6; i += 1) {
    const got = londonParts(new Date(utc));
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
    const actual = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, 0);
    const delta = desired - actual;
    if (delta === 0) return new Date(utc);
    utc += delta;
  }
  return new Date(utc);
}

export function expectedUtcCron(now) {
  const parts = londonParts(now);
  const target = utcForLondonWallClock(parts.year, parts.month, parts.day, 2, 0);
  return target.getUTCHours() === 1 ? "0 1 * * *" : "0 2 * * *";
}

export function shouldRunScheduledScan({ now = new Date(), schedule = "", eventName = "schedule" } = {}) {
  if (eventName === "workflow_dispatch") {
    return { run: true, reason: "manual trigger" };
  }
  const parts = londonParts(now);
  const expected = expectedUtcCron(now);
  if (schedule !== expected) {
    return {
      run: false,
      reason: `slot ${schedule || "(none)"} is not 02:00 Europe/London (expected ${expected})`,
    };
  }
  if (parts.hour < 2 || parts.hour > 5) {
    const hh = String(parts.hour).padStart(2, "0");
    const mm = String(parts.minute).padStart(2, "0");
    return {
      run: false,
      reason: `London time ${hh}:${mm} is outside the 02:00 to 05:59 delay window`,
    };
  }
  return {
    run: true,
    reason: `02:00 Europe/London slot (${expected}), London hour ${parts.hour}`,
  };
}

function writeOutput(decision) {
  const line = `run=${decision.run ? "true" : "false"}\nreason=${decision.reason}\n`;
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, line);
  const summary = decision.run
    ? `Security scan will run. ${decision.reason}`
    : `SECURITY_SCAN_CONCLUSION=skipped. ${decision.reason} This is not a scan result and it is not a clean result.`;
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  console.log(summary);
}

function isCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isCli()) {
  const decision = shouldRunScheduledScan({
    now: process.env.SECURITY_SCAN_NOW ? new Date(process.env.SECURITY_SCAN_NOW) : new Date(),
    schedule: process.env.SECURITY_SCAN_SCHEDULE || "",
    eventName: process.env.SECURITY_SCAN_EVENT || "schedule",
  });
  writeOutput(decision);
}
