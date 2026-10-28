import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { resolveZapTarget, resolveZapTargetFromTexts } from "./resolve-zap-target.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

test("repository site URL sources agree on the public site", () => {
  assert.equal(resolveZapTarget(root), "https://www.legalshaman.com")
})

test("disagreeing sources are not guessed", () => {
  assert.throws(
    () => resolveZapTargetFromTexts({
      envExample: "NEXT_PUBLIC_SITE_URL=https://www.legalshaman.com\n",
      emailConfig: 'export function resolveSiteUrl() {\n  return "https://legalshaman.com";\n}\n',
      layout: 'export const metadata = { metadataBase: new URL("https://www.legalshaman.com") }\n',
    }),
    /without guessing/,
  )
})

test("a commented example URL is still a configured URL", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zap-target-"))
  fs.mkdirSync(path.join(dir, "web/lib/email"), { recursive: true })
  fs.mkdirSync(path.join(dir, "web/app"), { recursive: true })
  fs.writeFileSync(path.join(dir, "web/.env.example"), "# NEXT_PUBLIC_SITE_URL=https://www.example.com\n")
  fs.writeFileSync(path.join(dir, "web/lib/email/config.ts"), 'export function resolveSiteUrl() {\n  return "https://www.example.com";\n}\n')
  fs.writeFileSync(path.join(dir, "web/app/layout.tsx"), 'metadataBase: new URL("https://www.example.com")\n')
  assert.equal(resolveZapTarget(dir), "https://www.example.com")
})
