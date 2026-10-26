import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const defaultRepoRoot = path.resolve(here, "../../..");

function stripTrailingSlash(url) {
  return url.replace(/\/+$/, "");
}

export function readConfigFallback(source) {
  const match = source.match(/function resolveSiteUrl\(\)\s*\{([\s\S]*?)\n\}/);
  if (!match) return [];
  return [...match[1].matchAll(/"(https:\/\/[^"]+)"/g)].map((item) => stripTrailingSlash(item[1]));
}

export function readEnvExampleUrls(source) {
  const urls = [];
  for (const line of source.split(/\n/)) {
    const match = line.match(/^\s*#?\s*NEXT_PUBLIC_SITE_URL\s*=\s*(https?:\/\/\S+)\s*$/);
    if (match) urls.push(stripTrailingSlash(match[1]));
  }
  return urls;
}

export function chooseScanTarget({ configUrls, envUrls }) {
  const unique = (values) => [...new Set(values)];
  const config = unique(configUrls);
  const env = unique(envUrls);
  if (config.length > 1) {
    return {
      ok: false,
      message:
        "The ZAP target could not be determined. resolveSiteUrl() in web/lib/email/config.ts contains more than one https fallback. Please tell me which public URL to scan.",
    };
  }
  if (env.length > 1) {
    return {
      ok: false,
      message:
        "The ZAP target could not be determined. web/.env.example sets NEXT_PUBLIC_SITE_URL more than once with different values. Please tell me which public URL to scan.",
    };
  }
  if (config.length === 1 && env.length === 1 && config[0] !== env[0]) {
    return {
      ok: false,
      message: `The ZAP target could not be determined. web/lib/email/config.ts falls back to ${config[0]} but web/.env.example has NEXT_PUBLIC_SITE_URL=${env[0]}. Please tell me which public URL to scan.`,
    };
  }
  const url = config[0] || env[0];
  if (!url) {
    return {
      ok: false,
      message:
        "The ZAP target could not be determined. Set the same https URL as the resolveSiteUrl() fallback in web/lib/email/config.ts and as NEXT_PUBLIC_SITE_URL in web/.env.example, then tell me if neither location is the deployed site.",
    };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, message: `The ZAP target could not be determined. ${url} is not a valid URL.` };
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    return {
      ok: false,
      message: `The ZAP target could not be determined. ${url} must be an https URL without embedded credentials.`,
    };
  }
  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
    return {
      ok: false,
      message: "The ZAP target could not be determined. The configured site URL is local. Please tell me the deployed https URL.",
    };
  }
  return { ok: true, url: stripTrailingSlash(parsed.toString()) };
}

export function resolveScanTargetFromRoot(root) {
  const configPath = path.join(root, "web/lib/email/config.ts");
  const envPath = path.join(root, "web/.env.example");
  let configSource = "";
  let envSource = "";
  try {
    configSource = readFileSync(configPath, "utf8");
  } catch {
    configSource = "";
  }
  try {
    envSource = readFileSync(envPath, "utf8");
  } catch {
    envSource = "";
  }
  return chooseScanTarget({
    configUrls: configSource ? readConfigFallback(configSource) : [],
    envUrls: envSource ? readEnvExampleUrls(envSource) : [],
  });
}

function main() {
  const root = process.argv[2] || defaultRepoRoot;
  const result = resolveScanTargetFromRoot(root);
  if (!result.ok) {
    process.stderr.write(`${result.message}\n`);
    process.exit(2);
  }
  process.stdout.write(`${result.url}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
