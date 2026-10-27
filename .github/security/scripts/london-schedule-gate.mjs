import fs from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * GitHub Actions cron is UTC only. 02:00 Europe/London is 01:00 UTC during
 * British Summer Time (UTC+1) and 02:00 UTC during GMT (UTC+0).
 * The workflow schedules both hours. This gate keeps the slot that is 02:00 in London.
 * It keys off the cron expression, not the delayed start time of the runner.
 */
export function londonOffsetMinutes(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/London",
    timeZoneName: "shortOffset",
    year: "numeric",
  }).formatToParts(date);
  const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = name.match(/([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!name || name === "GMT" || name === "UTC") return 0;
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

export function shouldRunScheduledScan(now, schedule) {
  const offset = londonOffsetMinutes(now);
  if (offset !== 0 && offset !== 60) {
    return {
      run: false,
      error: `Europe/London offset was ${offset}. Expected 0 (GMT) or 60 (BST). Refusing to guess which UTC hour is 02:00.`,
    };
  }
  const match = String(schedule ?? "").trim().match(/^0 (\d{1,2}) \* \* \*$/);
  if (!match) {
    return { run: false, error: `Unrecognised cron expression: ${schedule || "(empty)"}` };
  }
  const scheduledUtcHour = Number(match[1]);
  if (scheduledUtcHour !== 1 && scheduledUtcHour !== 2) {
    return {
      run: false,
      error: `This workflow only schedules 01:00 and 02:00 UTC. Refusing cron ${schedule}.`,
    };
  }
  const expectedUtcHour = offset === 60 ? 1 : 2;
  const run = scheduledUtcHour === expectedUtcHour;
  const zone = offset === 60 ? "BST (UTC+1)" : "GMT (UTC+0)";
  const reason = run
    ? `Running. ${zone} makes 02:00 Europe/London equal to ${String(expectedUtcHour).padStart(2, "0")}:00 UTC (${schedule}).`
    : `Skipping ${schedule}. ${zone} means 02:00 Europe/London is ${String(expectedUtcHour).padStart(2, "0")}:00 UTC, so this slot does not run. This is not a scan result.`;
  return { run, offsetMinutes: offset, expectedUtcHour, scheduledUtcHour, reason };
}

function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  fs.appendFileSync(file, `${key}=${String(value).replace(/\r?\n/g, " ")}\n`);
}

function main() {
  const event = process.env.GITHUB_EVENT_NAME || "workflow_dispatch";
  const now = process.env.SCAN_NOW ? new Date(process.env.SCAN_NOW) : new Date();
  if (Number.isNaN(now.getTime())) {
    console.error("SCAN_NOW is not a valid date.");
    process.exit(1);
  }

  if (event !== "schedule") {
    const reason = "Manual run. The London schedule gate does not apply.";
    setOutput("run", "true");
    setOutput("reason", reason);
    console.log(reason);
    return;
  }

  const ref = process.env.GITHUB_REF_NAME || "";
  const def = process.env.GITHUB_DEFAULT_BRANCH || "main";
  if (ref && ref !== def) {
    console.error(`Scheduled run is on ${ref}, not the default branch ${def}. Refusing to scan.`);
    process.exit(1);
  }

  const decision = shouldRunScheduledScan(now, process.env.GITHUB_EVENT_SCHEDULE || "");
  if (decision.error) {
    console.error(decision.error);
    process.exit(1);
  }
  setOutput("run", decision.run ? "true" : "false");
  setOutput("reason", decision.reason);
  console.log(decision.reason);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
