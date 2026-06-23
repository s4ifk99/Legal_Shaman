/**
 * Restore Typesense for Legal Shaman:
 *   1. Provision a new Typesense Cloud cluster (optional), or use existing host in env
 *   2. Re-index legal_entities from Postgres
 *
 * Provision (new cluster):
 *   TYPESENSE_CLOUD_MANAGEMENT_API_KEY=... npm run typesense:restore -- --provision
 *
 * Index only (host already in TYPESENSE_HOST):
 *   npm run typesense:restore
 *
 * Options:
 *   --provision          Create cluster via Typesense Cloud API (london, 2_gb)
 *   --cluster-id=ID      Use existing cloud cluster instead of creating
 *   --skip-index         Only provision / print env vars
 *   --index=sra|all      Index source (default: all)
 */
import "./load-dotenv";
import { syncLegalEntitiesToTypesense } from "../lib/search-index/sync-typesense";
import { buildTypesenseListingsClientFromEnv } from "../lib/search/typesense-listings-client";
import { typesenseServerHealth } from "../lib/search-index/typesense-legal-entities-index";
import type { IndexSource } from "../lib/search-index/types";

const CLOUD_API = "https://cloud.typesense.org/api/v1";

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

type CloudCluster = {
  id: string;
  status: string;
  hostnames?: {
    load_balanced?: string;
    nodes?: string[];
  };
};

async function cloudFetch(path: string, init?: RequestInit): Promise<unknown> {
  const key = process.env.TYPESENSE_CLOUD_MANAGEMENT_API_KEY?.trim();
  if (!key) {
    throw new Error("Missing TYPESENSE_CLOUD_MANAGEMENT_API_KEY (from cloud.typesense.org → API Keys)");
  }
  const res = await fetch(`${CLOUD_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-TYPESENSE-CLOUD-MANAGEMENT-API-KEY": key,
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Typesense Cloud API ${path} failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function waitForCluster(clusterId: string, maxMinutes = 12): Promise<CloudCluster> {
  const deadline = Date.now() + maxMinutes * 60_000;
  while (Date.now() < deadline) {
    const data = (await cloudFetch(`/clusters/${clusterId}`)) as CloudCluster;
    console.log(`Cluster ${clusterId} status: ${data.status}`);
    if (data.status === "in_service") return data;
    if (data.status === "terminated" || data.status === "suspended") {
      throw new Error(`Cluster ${clusterId} is ${data.status}`);
    }
    await new Promise((r) => setTimeout(r, 20_000));
  }
  throw new Error(`Timed out waiting for cluster ${clusterId}`);
}

async function provisionCluster(): Promise<{ host: string; clusterId: string }> {
  const region = process.env.TYPESENSE_CLOUD_REGION?.trim() || "london";
  const memory = process.env.TYPESENSE_CLOUD_MEMORY?.trim() || "2_gb";
  const vcpu = process.env.TYPESENSE_CLOUD_VCPU?.trim() || "2_vcpus_4_hr_burst_per_day";

  console.log(`Provisioning Typesense Cloud cluster (${memory}, ${region})…`);
  const created = (await cloudFetch("/clusters", {
    method: "POST",
    body: JSON.stringify({
      name: "legal-shaman",
      memory,
      vcpu,
      regions: [region],
      typesense_server_version: "27.1",
    }),
  })) as { cluster?: CloudCluster };

  const clusterId = created.cluster?.id;
  if (!clusterId) throw new Error("No cluster id in provision response");

  const ready = await waitForCluster(clusterId);
  const host =
    ready.hostnames?.load_balanced ||
    ready.hostnames?.nodes?.[0];
  if (!host) throw new Error("Cluster in_service but no hostname returned");

  const keys = (await cloudFetch(`/clusters/${clusterId}/api-keys`, { method: "POST" })) as {
    api_keys?: { admin_key?: string; search_only_key?: string };
  };
  const adminKey = keys.api_keys?.admin_key;
  if (!adminKey) throw new Error("Failed to generate cluster API keys");

  process.env.TYPESENSE_HOST = host;
  process.env.TYPESENSE_API_KEY = adminKey;
  process.env.TYPESENSE_PROTOCOL = "https";
  process.env.TYPESENSE_PORT = "443";

  console.log("\n=== Update Vercel + GitHub secrets ===");
  console.log(`TYPESENSE_HOST=${host}`);
  console.log(`TYPESENSE_API_KEY=${adminKey}`);
  console.log("TYPESENSE_PROTOCOL=https");
  console.log("TYPESENSE_PORT=443");
  console.log(`# cluster id: ${clusterId}`);

  return { host, clusterId };
}

async function useExistingCluster(clusterId: string): Promise<string> {
  const ready = await waitForCluster(clusterId, 1);
  const host =
    ready.hostnames?.load_balanced ||
    ready.hostnames?.nodes?.[0];
  if (!host) throw new Error("No hostname on cluster");
  return host;
}

async function assertTypesenseReachable(): Promise<void> {
  const client = buildTypesenseListingsClientFromEnv();
  if (!client) {
    throw new Error("TYPESENSE_HOST and TYPESENSE_API_KEY required");
  }
  const health = await typesenseServerHealth(client);
  if (!health.ok) {
    throw new Error(`Typesense unreachable at ${process.env.TYPESENSE_HOST}: ${health.error ?? "health failed"}`);
  }
  console.log("Typesense health OK", health.version ? `(v${health.version})` : "");
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL required to re-index from Postgres");
  }

  const clusterId = flag("cluster-id");
  if (hasFlag("provision")) {
    await provisionCluster();
  } else if (clusterId) {
    const host = await useExistingCluster(clusterId);
    process.env.TYPESENSE_HOST = host;
    process.env.TYPESENSE_PROTOCOL = "https";
    process.env.TYPESENSE_PORT = "443";
    console.log(`Using cluster ${clusterId} → ${host}`);
  }

  await assertTypesenseReachable();

  if (hasFlag("skip-index")) {
    console.log("Skip index requested — done.");
    return;
  }

  const indexArg = (flag("index") || "all").toLowerCase();
  const source = (
    ["curated", "legal_aid", "lawyers", "sra", "probono", "all"].includes(indexArg)
      ? indexArg
      : "all"
  ) as IndexSource;

  process.env.SRA_INDEX_SKIP_GEO = process.env.SRA_INDEX_SKIP_GEO ?? "1";
  process.env.TYPESENSE_IMPORT_BATCH_SIZE = process.env.TYPESENSE_IMPORT_BATCH_SIZE ?? "25";
  process.env.TYPESENSE_IMPORT_PAUSE_MS = process.env.TYPESENSE_IMPORT_PAUSE_MS ?? "500";

  console.log(`Indexing ${source} → legal_entities…`);
  const stats = await syncLegalEntitiesToTypesense(source);
  if (stats.degraded || stats.errors.length) {
    console.error("Index errors:", stats.errors);
    if (stats.resumeAfter) console.error("Resume with: --resume-after=", stats.resumeAfter);
    process.exit(1);
  }
  console.log("Index complete:", stats);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
