import { pathToFileURL } from "node:url";

function londonParts(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    hour: map.hour,
    offset: map.timeZoneName,
    day: `${map.year}-${map.month}-${map.day}`,
  };
}

export function scheduledSlotShouldRun(date) {
  const london = londonParts(date);
  const utcHour = String(date.getUTCHours()).padStart(2, "0");
  const bst = london.offset === "GMT+1";
  const gmt = london.offset === "GMT" || london.offset === "GMT+0";
  const run = (bst && utcHour === "01" && london.hour === "02") || (gmt && utcHour === "02" && london.hour === "02");
  return {
    run,
    utcHour,
    londonHour: london.hour,
    offset: london.offset,
    londonDay: london.day,
    reason: run
      ? `02:00 Europe/London (${london.offset}, UTC ${utcHour}:00)`
      : `skip: London ${london.hour}:00 ${london.offset} while UTC hour is ${utcHour}`,
  };
}

function main() {
  if (process.argv.includes("--manual")) {
    const now = scheduledSlotShouldRun(new Date());
    process.stdout.write(`run=true\nreason=manual\nlondon_day=${now.londonDay}\n`);
    return;
  }
  const input = process.argv.find((arg) => arg.startsWith("--at="));
  const date = input ? new Date(input.slice(5)) : new Date();
  if (Number.isNaN(date.getTime())) {
    process.stderr.write("invalid --at timestamp\n");
    process.exit(2);
  }
  const decision = scheduledSlotShouldRun(date);
  process.stdout.write(
    `run=${decision.run ? "true" : "false"}\nreason=${decision.reason}\nlondon_day=${decision.londonDay}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
