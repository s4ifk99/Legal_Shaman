import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { runAppChecks } from "./app-security-checks.mjs"

test("application checks flag missing admin auth and request SQL", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "app-checks-"))
  const route = path.join(root, "web/app/api/admin/open")
  fs.mkdirSync(route, { recursive: true })
  fs.mkdirSync(path.join(root, "web"), { recursive: true })
  fs.writeFileSync(path.join(route, "route.ts"), "export async function GET() { return Response.json({ ok: true }) }\n")
  fs.writeFileSync(path.join(root, "web/middleware.ts"), 'if (pathname.startsWith("/api/admin")) {}\n')
  fs.writeFileSync(path.join(root, "web/queries.ts"), [
    "export async function leak(searchParams) {",
    "  return db.$queryRawUnsafe(`SELECT * FROM users WHERE name = '${searchParams.get(\"name\")}'`)",
    "}",
    "export async function staticSql() {",
    "  return db.$executeRawUnsafe(`SELECT 1`)",
    "}",
    "export async function limited(limit) {",
    "  return db.$queryRawUnsafe(`SELECT ${limit}`)",
    "}",
  ].join("\n"))
  fs.writeFileSync(path.join(root, "web/next.config.mjs"), "const nextConfig = { typescript: { ignoreBuildErrors: true } }\nexport default nextConfig\n")
  const planted = "PLANTED-ENV-SECRET-VALUE"
  fs.writeFileSync(path.join(root, "web/.env.local"), `API_KEY=${planted}\n`)

  const findings = runAppChecks(root)
  const titles = findings.map((item) => item.title)
  assert.ok(titles.includes("Admin route does not call the admin authorisation helper"))
  assert.ok(titles.includes("Raw SQL interpolates request data"))
  assert.ok(titles.includes("Raw SQL interpolates a value"))
  assert.ok(titles.includes("Static SQL uses an unsafe query API"))
  assert.ok(titles.includes("Production builds ignore TypeScript errors"))
  assert.ok(titles.includes("Next.js config does not set baseline security headers"))
  assert.ok(titles.includes("Secret env file is in the scanned tree"))
  assert.equal(JSON.stringify(findings).includes(planted), false)
  assert.equal(findings.find((item) => item.title === "Raw SQL interpolates request data").severity, "high")
  assert.equal(findings.find((item) => item.title === "Raw SQL interpolates a value").severity, "medium")
})
