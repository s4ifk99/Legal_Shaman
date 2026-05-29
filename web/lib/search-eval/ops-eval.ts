/**
 * Deterministic ops / environment guard checks (no network).
 */
import {
  assertEnvironmentForOps,
  getEnvironmentSnapshot,
} from "@/lib/ops/environment-guard";
import {
  extractFirmNameFromSraSearchText,
  isPlaceholderSraBusinessName,
  resolveSraDisplayName,
} from "@/lib/search/sra-display";
import { requireAdminApiRequest } from "@/lib/admin/auth";

export async function runOpsEval(): Promise<number> {
  let failed = 0;
  const env = process.env as Record<string, string | undefined>;
  const prev = {
    NODE_ENV: env.NODE_ENV,
    VERCEL_ENV: env.VERCEL_ENV,
    DATABASE_URL: env.DATABASE_URL,
    TYPESENSE_HOST: env.TYPESENSE_HOST,
    TYPESENSE_API_KEY: env.TYPESENSE_API_KEY,
    ADMIN_SECRET: env.ADMIN_SECRET,
    SEARCH_EVENT_SALT: env.SEARCH_EVENT_SALT,
  };

  try {
    env.NODE_ENV = "production";
    env.VERCEL_ENV = "production";
    env.DATABASE_URL = "postgresql://u:p@localhost:5432/legal_shaman";
    env.TYPESENSE_HOST = "http://127.0.0.1:8108";
    env.TYPESENSE_API_KEY = "test";
    delete env.ADMIN_SECRET;
    delete env.SEARCH_EVENT_SALT;

    const guard = assertEnvironmentForOps({ yes: false, allowLocal: false });
    if (guard.ok) {
      console.error("FAIL env guard should block localhost production without --allow-local");
      failed++;
    }
    if (!guard.ok && !guard.errors.some((e: string) => e.includes("localhost"))) {
      console.error("FAIL env guard should mention localhost");
      failed++;
    }

    env.ADMIN_SECRET = "test-secret";
    env.SEARCH_EVENT_SALT = "test-salt";
    const guard2 = assertEnvironmentForOps({ yes: false, allowLocal: true });
    if (
      guard2.ok ||
      (!guard2.ok && !guard2.errors.some((e: string) => e.includes("--yes")))
    ) {
      console.error("FAIL env guard should require --yes in production");
      failed++;
    }

    const guard3 = assertEnvironmentForOps({ yes: true, allowLocal: true });
    if (!guard3.ok) {
      console.error("FAIL env guard should pass with --yes and --allow-local", guard3.errors);
      failed++;
    }

    const name = resolveSraDisplayName(
      "Organisation 921469",
      "921469\nBhayani HR & Employment Law\nSHEFFIELD",
      "921469",
    );
    if (name !== "Bhayani HR & Employment Law") {
      console.error(`FAIL SRA display name resolution got "${name}"`);
      failed++;
    }

    if (!isPlaceholderSraBusinessName("Organisation 921469", "921469")) {
      console.error("FAIL placeholder detection");
      failed++;
    }

    const extracted = extractFirmNameFromSraSearchText(
      "921469\nTest Firm LLP\nLondon",
      "921469",
    );
    if (extracted !== "Test Firm LLP") {
      console.error(`FAIL extractFirmNameFromSraSearchText got "${extracted}"`);
      failed++;
    }

    env.NODE_ENV = "production";
    env.ADMIN_SECRET = "eval-ops-secret";
    const deny = await requireAdminApiRequest(
      new Request("http://localhost/api/admin/jobs/daily"),
    );
    if (!deny || deny.status !== 401) {
      console.error("FAIL admin jobs API should require auth");
      failed++;
    }

    const snap = getEnvironmentSnapshot();
    if (!snap.typesenseHost) {
      console.error("FAIL environment snapshot should include typesense host");
      failed++;
    }

  } finally {
    if (prev.NODE_ENV !== undefined) env.NODE_ENV = prev.NODE_ENV;
    else delete env.NODE_ENV;
    if (prev.VERCEL_ENV !== undefined) env.VERCEL_ENV = prev.VERCEL_ENV;
    else delete env.VERCEL_ENV;
    if (prev.DATABASE_URL !== undefined) env.DATABASE_URL = prev.DATABASE_URL;
    else delete env.DATABASE_URL;
    if (prev.TYPESENSE_HOST !== undefined) env.TYPESENSE_HOST = prev.TYPESENSE_HOST;
    else delete env.TYPESENSE_HOST;
    if (prev.TYPESENSE_API_KEY !== undefined) env.TYPESENSE_API_KEY = prev.TYPESENSE_API_KEY;
    else delete env.TYPESENSE_API_KEY;
    if (prev.ADMIN_SECRET !== undefined) env.ADMIN_SECRET = prev.ADMIN_SECRET;
    else delete env.ADMIN_SECRET;
    if (prev.SEARCH_EVENT_SALT !== undefined) env.SEARCH_EVENT_SALT = prev.SEARCH_EVENT_SALT;
    else delete env.SEARCH_EVENT_SALT;
  }

  if (failed === 0) {
    console.info("PASS ops eval (environment guard, SRA display, admin jobs auth)");
  }
  return failed;
}
