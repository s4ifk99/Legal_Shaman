import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot, writeStatus } from "./lib.mjs";

const EXPECTED = "https://www.legalshaman.com";

export function resolveTargetUrls(root = repoRoot) {
  const envPath = path.join(root, "web/.env.example");
  const configPath = path.join(root, "web/lib/email/config.ts");
  const layoutPath = path.join(root, "web/app/layout.tsx");
  const envText = fs.readFileSync(envPath, "utf8");
  const configText = fs.readFileSync(configPath, "utf8");
  const layoutText = fs.readFileSync(layoutPath, "utf8");

  const envMatch = envText.match(/^#?\s*NEXT_PUBLIC_SITE_URL=(https:\/\/\S+?)\s*$/m);
  const configMatch = configText.match(/"(https:\/\/www\.legalshaman\.com)"/);
  const layoutMatch = layoutText.match(/new URL\("(https:\/\/www\.legalshaman\.com)"\)/);

  return {
    envExample: envMatch?.[1]?.replace(/\/+$/, "") ?? "",
    emailConfig: configMatch?.[1] ?? "",
    layout: layoutMatch?.[1] ?? "",
  };
}

export function assertSingleTarget(urls) {
  const values = [urls.envExample, urls.emailConfig, urls.layout];
  if (values.some((value) => value !== EXPECTED)) {
    return {
      ok: false,
      url: "",
      detail:
        "Could not determine one deployed URL. web/.env.example NEXT_PUBLIC_SITE_URL, the fallback in web/lib/email/config.ts, and metadataBase in web/app/layout.tsx must all be https://www.legalshaman.com. Set those three to the same public https URL and rerun. No target was guessed.",
    };
  }
  return { ok: true, url: EXPECTED, detail: `ZAP target is ${EXPECTED}.` };
}

function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  fs.appendFileSync(file, `${key}=${String(value).replace(/\r?\n/g, " ")}\n`);
}

function main() {
  let decision;
  try {
    decision = assertSingleTarget(resolveTargetUrls());
  } catch (error) {
    decision = {
      ok: false,
      url: "",
      detail: `Could not read the site URL from repository configuration: ${error instanceof Error ? error.message : "read failed"}. No target was guessed.`,
    };
  }

  if (process.env.REPORT_DIR) {
    writeStatus("target-url", decision.ok ? "completed" : "failed", decision.detail);
    if (!decision.ok) {
      writeStatus("zap-baseline", "failed", decision.detail);
    }
  }

  if (!decision.ok) {
    console.error(decision.detail);
    process.exit(1);
  }

  if (process.env.REPORT_DIR) {
    fs.writeFileSync(path.join(process.env.REPORT_DIR, "target-url.txt"), `${decision.url}\n`);
  }
  setOutput("url", decision.url);
  console.log(decision.detail);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
