import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export function londonParts(now) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)
  const map = {}
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value
  }
  let hour = Number(map.hour)
  if (map.dayPeriod) {
    const period = map.dayPeriod.toLowerCase()
    if (period.includes("pm") && hour < 12) hour += 12
    if (period.includes("am") && hour === 12) hour = 0
  }
  if (hour === 24) hour = 0
  return {
    hour,
    minute: Number(map.minute),
    year: map.year,
    month: map.month,
    day: map.day,
  }
}

export function evaluateSchedule({ eventName, now }) {
  const london = londonParts(now)
  const proceed = eventName !== "schedule" || london.hour === 2
  return { proceed, london, eventName: eventName || "workflow_dispatch" }
}

function stamp(london) {
  const hour = String(london.hour).padStart(2, "0")
  const minute = String(london.minute).padStart(2, "0")
  return `${london.year}-${london.month}-${london.day}T${hour}:${minute}`
}

function main() {
  const eventName = process.env.GITHUB_EVENT_NAME || "workflow_dispatch"
  const now = process.env.SECURITY_SCAN_NOW ? new Date(process.env.SECURITY_SCAN_NOW) : new Date()
  if (Number.isNaN(now.getTime())) {
    console.error("SECURITY_SCAN_NOW is not a valid date. The schedule gate failed closed.")
    process.exit(1)
  }
  const result = evaluateSchedule({ eventName, now })
  const line = `event=${result.eventName} london=${stamp(result.london)} proceed=${result.proceed}`
  console.log(line)
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `proceed=${result.proceed}\n`)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `london=${stamp(result.london)}\n`)
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
