/**
 * List pending crawler fields via admin HTTP API (x-admin-secret).
 * Requires dev server: npm run dev
 */
import "./load-dotenv";

import { adminGet, getAdminApiBaseUrl, requireAdminSecretForScript } from "@/lib/admin/http";

async function main() {
  requireAdminSecretForScript();
  const res = await adminGet<{
    pending: unknown[];
    queuedJobs: unknown[];
  }>("/api/admin/provider-crawler");

  if (!res.ok) {
    console.error(
      JSON.stringify({
        event: "providers_crawl_review_api_error",
        status: res.status,
        base: getAdminApiBaseUrl(),
        error: res.data,
      }),
    );
    process.exit(1);
  }

  const pending = res.data.pending ?? [];
  const queuedJobs = res.data.queuedJobs ?? [];
  console.info(
    JSON.stringify({
      event: "providers_crawl_review_api",
      base: getAdminApiBaseUrl(),
      pendingCount: pending.length,
      queuedJobs: queuedJobs.length,
      pending: pending.slice(0, 20),
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
