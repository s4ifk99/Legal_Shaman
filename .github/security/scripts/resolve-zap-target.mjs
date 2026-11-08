import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SOURCES = [
  {
    id: "web/.env.example",
    file: "web/.env.example",
    read(text) {
      const match = text.match(/^#?\s*NEXT_PUBLIC_SITE_URL=(https?:\/\/\S+)\s*$/m);
      return match ? match[1].replace(/\/+$/, "") : null;
    },
  },
  {
    id: "web/lib/email/config.ts",
    file: "web/lib/email/config.ts",
    read(text) {
      const block = text.match(/function resolveSiteUrl\(\)[\s\S]*?\n\}/);
      if (!block) return null;
      const urls = [...block[0].matchAll(/"(https?:\/\/[^"]+)"/g)].map((item) => item[1]);
      return urls.at(-1)?.replace(/\/+$/, "") ?? null;
    },
  },
  {
    id: "web/lib/email/triage-summary-template.ts",
    file: "web/lib/email/triage-summary-template.ts",
    read(text) {
      const block = text.match(/function resolveSiteUrl\(\)[\s\S]*?\n\}/);
      if (!block) return null;
      const urls = [...block[0].matchAll(/"(https?:\/\/[^"]+)"/g)].map((item) => item[1]);
      return urls.at(-1)?.replace(/\/+$/, "") ?? null;
    },
  },
  {
    id: "web/app/layout.tsx",
    file: "web/app/layout.tsx",
    read(text) {
      const match = text.match(/metadataBase:\s*new URL\("([^"]+)"\)/);
      return match ? match[1].replace(/\/+$/, "") : null;
    },
  },
];

export function resolveZapTarget(rootDir) {
  const found = {};
  const missing = [];
  for (const source of SOURCES) {
    const full = path.join(rootDir, source.file);
    if (!fs.existsSync(full)) {
      missing.push(source.id);
      found[source.id] = null;
      continue;
    }
    const url = source.read(fs.readFileSync(full, "utf8"));
    found[source.id] = url;
    if (!url) missing.push(source.id);
  }
  const values = Object.values(found).filter(Boolean);
  const unique = [...new Set(values)];
  if (missing.length || unique.length !== 1) {
    return {
      ok: false,
      url: null,
      sources: found,
      error:
        "ZAP target URL cannot be determined. NEXT_PUBLIC_SITE_URL in web/.env.example, the resolveSiteUrl fallback in web/lib/email/config.ts and web/lib/email/triage-summary-template.ts, and metadataBase in web/app/layout.tsx must all be the same public https URL. This scan will not guess.",
    };
  }
  const url = unique[0];
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, url: null, sources: found, error: `ZAP target is not a valid URL: ${url}` };
  }
  const host = parsed.hostname.toLowerCase();
  const local =
    parsed.protocol !== "https:" ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.endsWith(".local");
  if (local) {
    return {
      ok: false,
      url: null,
      sources: found,
      error: `ZAP target ${url} is not a public https site. Refusing to scan it.`,
    };
  }
  return { ok: true, url, sources: found, error: null };
}

function isCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isCli()) {
  const root = process.argv[2] || process.cwd();
  const result = resolveZapTarget(root);
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
  process.stdout.write(`${result.url}\n`);
}
