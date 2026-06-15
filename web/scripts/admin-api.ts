/**
 * Admin API CLI — uses x-admin-secret header (no browser login).
 *
 * Requires ADMIN_SECRET in env and a running app (default http://localhost:3000).
 *
 * Examples:
 *   npm run admin:api -- crawl list
 *   npm run admin:api -- crawl approve <field-id>
 *   npm run admin:api -- crawl reject <field-id>
 *   npm run admin:api -- enrichment list
 *   npm run admin:api -- enrichment approve <id>
 */
import "./load-dotenv";

import { adminGet, adminPost, getAdminApiBaseUrl, requireAdminSecretForScript } from "@/lib/admin/http";

function usage(): void {
  console.error(`
Usage: npm run admin:api -- <resource> <action> [args]

Resources:
  crawl list [--category=field|testimonial|review_signal]
  crawl approve <fieldId>
  crawl reject <fieldId>
  crawl queue <entityId> <entityType> [mode]

  enrichment list
  enrichment approve <id>
  enrichment reject <id>

Env:
  ADMIN_SECRET          (required)
  ADMIN_API_BASE_URL    (default http://localhost:3000)
`);
}

async function main() {
  requireAdminSecretForScript();
  const argv = process.argv.slice(2);
  const resource = argv[0];
  const action = argv[1];

  if (!resource || !action || resource === "--help" || resource === "-h") {
    usage();
    process.exit(resource ? 0 : 1);
  }

  const base = getAdminApiBaseUrl();

  if (resource === "crawl") {
    if (action === "list") {
      const cat = argv.find((a) => a.startsWith("--category="))?.split("=")[1];
      const qs = cat ? `?reviewCategory=${encodeURIComponent(cat)}` : "";
      const res = await adminGet(`/api/admin/provider-crawler${qs}`);
      if (!res.ok) {
        console.error(JSON.stringify({ error: res.data, status: res.status, base }));
        process.exit(1);
      }
      console.info(JSON.stringify(res.data, null, 2));
      return;
    }
    if (action === "approve" || action === "reject") {
      const id = argv[2];
      if (!id) {
        console.error("Missing field id");
        process.exit(1);
      }
      const res = await adminPost(`/api/admin/provider-crawler/${id}`, { action });
      if (!res.ok) {
        console.error(JSON.stringify({ error: res.data, status: res.status }));
        process.exit(1);
      }
      console.info(JSON.stringify(res.data));
      return;
    }
    if (action === "queue") {
      const [entityId, entityType, mode] = argv.slice(2);
      if (!entityId || !entityType) {
        console.error("Usage: crawl queue <entityId> <entityType> [mode]");
        process.exit(1);
      }
      const res = await adminPost("/api/admin/provider-crawler", {
        action: "queue",
        entityId,
        entityType,
        mode: mode ?? "all",
      });
      if (!res.ok) {
        console.error(JSON.stringify({ error: res.data, status: res.status }));
        process.exit(1);
      }
      console.info(JSON.stringify(res.data));
      return;
    }
  }

  if (resource === "enrichment") {
    if (action === "list") {
      const res = await adminGet("/api/admin/provider-enrichment");
      if (!res.ok) {
        console.error(JSON.stringify({ error: res.data, status: res.status, base }));
        process.exit(1);
      }
      console.info(JSON.stringify(res.data, null, 2));
      return;
    }
    if (action === "approve" || action === "reject") {
      const id = argv[2];
      if (!id) {
        console.error("Missing enrichment id");
        process.exit(1);
      }
      const res = await adminPost(`/api/admin/provider-enrichment/${id}`, { action });
      if (!res.ok) {
        console.error(JSON.stringify({ error: res.data, status: res.status }));
        process.exit(1);
      }
      console.info(JSON.stringify(res.data));
      return;
    }
  }

  usage();
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
