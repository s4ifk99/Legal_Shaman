import { lookup } from "node:dns/promises";

import { usePostgresDirectorySearch } from "@/lib/legal-search/config";

/** True when production directory search uses Postgres (Typesense optional for CI/ops). */
export function typesenseOptionalForOps(): boolean {
  if (usePostgresDirectorySearch()) return true;
  const v = process.env.TYPESENSE_OPTIONAL?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** DNS check — catches terminated Typesense Cloud clusters (ENOTFOUND). */
export async function isTypesenseHostReachable(): Promise<boolean> {
  const host = process.env.TYPESENSE_HOST?.trim();
  if (!host || host === "localhost" || host === "127.0.0.1") return Boolean(host);
  try {
    await lookup(host);
    return true;
  } catch {
    return false;
  }
}

export async function shouldRunTypesenseOps(): Promise<{ run: boolean; reason?: string }> {
  if (typesenseOptionalForOps()) {
    const host = process.env.TYPESENSE_HOST?.trim();
    if (!host) return { run: false, reason: "Typesense optional (Postgres directory search)" };
    const reachable = await isTypesenseHostReachable();
    return {
      run: false,
      reason: reachable
        ? "Typesense optional (Postgres directory search)"
        : `Typesense optional — host unreachable (${host}); restore per docs/ops/restore-typesense.md`,
    };
  }

  const host = process.env.TYPESENSE_HOST?.trim();
  if (!host) return { run: false, reason: "TYPESENSE_HOST unset" };
  if (!(await isTypesenseHostReachable())) {
    return { run: false, reason: `TYPESENSE_HOST does not resolve (${host})` };
  }
  return { run: true };
}
