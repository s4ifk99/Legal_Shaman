import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const WINTER_CRON = "0 2 * * *";
const SUMMER_CRON = "0 1 * * *";

export function londonOffsetHours(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  const match = name.match(/GMT([+-]\d+)?/);
  if (!match) return null;
  if (!match[1]) return 0;
  const offset = Number(match[1]);
  return Number.isInteger(offset) ? offset : null;
}

export function expectedCronForOffset(offset) {
  if (offset === 0) return WINTER_CRON;
  if (offset === 1) return SUMMER_CRON;
  return null;
}

export function decideSchedule({ now = new Date(), eventName, schedule = "" }) {
  const offset = londonOffsetHours(now);
  if (eventName === "workflow_dispatch") {
    return {
      run: true,
      failClosed: false,
      offset,
      reason: "Manual workflow_dispatch runs immediately and does not wait for 02:00 London.",
    };
  }
  const expected = expectedCronForOffset(offset);
  if (expected == null) {
    return {
      run: false,
      failClosed: true,
      offset,
      reason: `SCAN FAILURE: Europe/London offset ${offset} is not GMT or BST, so the 02:00 slot could not be chosen. No scan ran.`,
    };
  }
  if (schedule === expected) {
    return {
      run: true,
      failClosed: false,
      offset,
      reason: `This cron is 02:00 Europe/London while the offset is UTC+${offset}.`,
    };
  }
  return {
    run: false,
    failClosed: false,
    offset,
    reason: `Skipped duplicate UTC cron ${schedule || "(none)"}. The 02:00 Europe/London slot is ${expected}. No scan ran, and this is not a clean result.`,
  };
}

export function writeGitHubOutput(target, decision) {
  if (!target) return;
  const lines = [
    `run=${decision.run ? "true" : "false"}`,
    `fail_closed=${decision.failClosed ? "true" : "false"}`,
    `offset=${decision.offset ?? ""}`,
    `reason=${decision.reason.replace(/\s+/g, " ").trim()}`,
    "",
  ];
  appendFileSync(target, lines.join("\n"));
}

function parseArgs(argv) {
  const args = { now: null, eventName: process.env.GITHUB_EVENT_NAME ?? "", schedule: process.env.GITHUB_EVENT_SCHEDULE ?? "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--now") args.now = new Date(argv[++i]);
    else if (arg === "--event") args.eventName = argv[++i];
    else if (arg === "--schedule") args.schedule = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const decision = decideSchedule({
    now: args.now ?? new Date(),
    eventName: args.eventName,
    schedule: args.schedule,
  });
  writeGitHubOutput(process.env.GITHUB_OUTPUT, decision);
  process.stdout.write(`${JSON.stringify(decision)}\n`);
  if (decision.failClosed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
