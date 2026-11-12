import { pathToFileURL } from "node:url";
import path from "node:path";

function hostKey(value) {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
}

export function assessZapPreflight({ target, httpCode, finalUrl, serverError }) {
  const code = Number(httpCode);
  const tag = String(serverError || "").trim();
  const tagNote = tag ? ` Server error tag: ${tag}.` : "";
  if (!Number.isInteger(code) || code < 200 || code > 299) {
    return {
      ok: false,
      error: `ZAP target ${target} returned HTTP ${httpCode || "000"} (final URL ${finalUrl || "unknown"}).${tagNote} The baseline was not run. A response that is not HTTP 2xx is not a scan of the application and it is not a clean result.`,
    };
  }
  let targetHost = "";
  let finalHost = "";
  try {
    targetHost = hostKey(target);
    finalHost = hostKey(finalUrl);
  } catch {
    return {
      ok: false,
      error: `ZAP preflight for ${target} did not return a usable final URL (${finalUrl || "missing"}). The baseline was not run.`,
    };
  }
  if (targetHost !== finalHost) {
    return {
      ok: false,
      error: `ZAP target ${target} redirected to ${finalUrl}, which is a different site. The baseline was not run.`,
    };
  }
  return { ok: true, error: null };
}

function isCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isCli()) {
  const result = assessZapPreflight({
    target: process.argv[2] || "",
    httpCode: process.argv[3] || "",
    finalUrl: process.argv[4] || "",
    serverError: process.argv[5] || "",
  });
  if (!result.ok) {
    process.stdout.write(`${result.error}\n`);
    process.exit(1);
  }
}
