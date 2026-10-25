import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const EXAMPLE = "web/.env.example";
const CONFIG = "web/lib/email/config.ts";

function read(root, rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

export function resolveTargetUrl(root) {
  const example = read(root, EXAMPLE);
  const config = read(root, CONFIG);
  const exampleMatch = example.match(/^#?\s*NEXT_PUBLIC_SITE_URL\s*=\s*(https:\/\/\S+)\s*$/m);
  const configMatch = config.match(/"https:\/\/www\.legalshaman\.com"/);
  const exampleUrl = exampleMatch ? exampleMatch[1].replace(/\/+$/, "") : "";
  const configUrl = configMatch ? "https://www.legalshaman.com" : "";
  if (!exampleUrl || !configUrl || exampleUrl !== configUrl) {
    return {
      ok: false,
      url: "",
      reason:
        "Production URL could not be confirmed. web/.env.example NEXT_PUBLIC_SITE_URL and the https://www.legalshaman.com default in web/lib/email/config.ts must exist and match.",
    };
  }
  let parsed;
  try {
    parsed = new URL(exampleUrl);
  } catch {
    return { ok: false, url: "", reason: "Production URL is not a valid URL." };
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    return { ok: false, url: "", reason: "Production URL must be https with no user, password, query, or fragment." };
  }
  return {
    ok: true,
    url: parsed.origin,
    reason: `Matched ${EXAMPLE} and the default site URL in ${CONFIG}.`,
  };
}

function main() {
  const root = process.argv[2] || process.cwd();
  const result = resolveTargetUrl(root);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
