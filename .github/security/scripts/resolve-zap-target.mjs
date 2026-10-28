import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

function normalise(url) {
  const parsed = new URL(url)
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("unsupported protocol")
  }
  parsed.hash = ""
  parsed.search = ""
  const text = parsed.toString().replace(/\/+$/, "")
  return text
}

function unique(values) {
  return [...new Set(values)]
}

export function siteUrlFromEnvExample(text) {
  const found = []
  for (const line of text.split(/\n/)) {
    const match = line.match(/^\s*#?\s*NEXT_PUBLIC_SITE_URL\s*=\s*(https?:\/\/\S+?)\s*$/)
    if (match) found.push(normalise(match[1]))
  }
  return unique(found)
}

export function siteUrlFromEmailConfig(text) {
  const body = text.match(/function resolveSiteUrl\(\)[^{]*\{([\s\S]*?)\n\}/)
  if (!body) throw new Error("resolveSiteUrl() was not found in web/lib/email/config.ts")
  const urls = unique([...body[1].matchAll(/"(https?:\/\/[^"]+)"/g)].map((match) => normalise(match[1])))
  if (urls.length !== 1) {
    throw new Error("resolveSiteUrl() must contain exactly one default site URL")
  }
  return urls[0]
}

export function siteUrlFromLayout(text) {
  const match = text.match(/metadataBase:\s*new URL\("([^"]+)"\)/)
  if (!match) throw new Error("metadataBase was not found in web/app/layout.tsx")
  return normalise(match[1])
}

export function resolveZapTargetFromTexts({ envExample, emailConfig, layout }) {
  const sources = {
    "web/.env.example": siteUrlFromEnvExample(envExample),
    "web/lib/email/config.ts": [siteUrlFromEmailConfig(emailConfig)],
    "web/app/layout.tsx": [siteUrlFromLayout(layout)],
  }
  const problems = []
  const values = []
  for (const [name, urls] of Object.entries(sources)) {
    if (urls.length !== 1) {
      problems.push(`${name} has ${urls.length} site URLs`)
    } else {
      values.push({ name, url: urls[0] })
    }
  }
  const distinct = unique(values.map((item) => item.url))
  if (problems.length || distinct.length !== 1) {
    const detail = [
      ...problems,
      ...values.map((item) => `${item.name}=${item.url}`),
    ].join("; ")
    throw new Error(
      `The public site URL could not be determined without guessing. Align NEXT_PUBLIC_SITE_URL in web/.env.example, the default in resolveSiteUrl(), and metadataBase. ${detail}`,
    )
  }
  return distinct[0]
}

export function resolveZapTarget(root) {
  const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8")
  return resolveZapTargetFromTexts({
    envExample: read("web/.env.example"),
    emailConfig: read("web/lib/email/config.ts"),
    layout: read("web/app/layout.tsx"),
  })
}

function main() {
  const root = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
  try {
    process.stdout.write(`${resolveZapTarget(root)}\n`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : "URL resolution failed")
    process.exit(2)
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
