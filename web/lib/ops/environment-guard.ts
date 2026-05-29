import { getMaskedDatabaseHost } from "@/lib/admin/api-response";

export type EnvironmentGuardOptions = {
  yes?: boolean;
  allowLocal?: boolean;
  force?: boolean;
};

export type EnvironmentSnapshot = {
  nodeEnv: string;
  vercelEnv: string | null;
  databaseHost: string | null;
  typesenseHost: string | null;
  adminSecretConfigured: boolean;
  searchEventSaltConfigured: boolean;
};

export type EnvironmentGuardResult =
  | { ok: true; snapshot: EnvironmentSnapshot }
  | { ok: false; snapshot: EnvironmentSnapshot; errors: string[] };

function isLocalhostHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  return (
    h.includes("localhost") ||
    h.includes("127.0.0.1") ||
    h.includes("0.0.0.0") ||
    h === "::1"
  );
}

function databaseUrlHost(): string | null {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

function typesenseHost(): string | null {
  const raw = process.env.TYPESENSE_HOST?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return raw;
  }
}

export function getEnvironmentSnapshot(): EnvironmentSnapshot {
  return {
    nodeEnv: process.env.NODE_ENV?.trim() || "development",
    vercelEnv: process.env.VERCEL_ENV?.trim() || null,
    databaseHost: getMaskedDatabaseHost(),
    typesenseHost: process.env.TYPESENSE_HOST?.trim() || null,
    adminSecretConfigured: Boolean(process.env.ADMIN_SECRET?.trim()),
    searchEventSaltConfigured: Boolean(process.env.SEARCH_EVENT_SALT?.trim()),
  };
}

export function printEnvironmentSnapshot(snapshot: EnvironmentSnapshot): void {
  console.info(
    JSON.stringify(
      {
        event: "ops_environment",
        NODE_ENV: snapshot.nodeEnv,
        VERCEL_ENV: snapshot.vercelEnv,
        DATABASE_URL_HOST: snapshot.databaseHost,
        TYPESENSE_HOST: snapshot.typesenseHost,
        ADMIN_SECRET: snapshot.adminSecretConfigured ? "(set)" : "(missing)",
        SEARCH_EVENT_SALT: snapshot.searchEventSaltConfigured ? "(set)" : "(missing)",
      },
      null,
      2,
    ),
  );
}

/** Validate env before production-touching jobs. */
export function assertEnvironmentForOps(
  opts: EnvironmentGuardOptions = {},
): EnvironmentGuardResult {
  const snapshot = getEnvironmentSnapshot();
  const errors: string[] = [];
  const isProd = snapshot.nodeEnv === "production" || snapshot.vercelEnv === "production";

  if (!process.env.DATABASE_URL?.trim()) {
    errors.push("DATABASE_URL is required");
  }
  if (!process.env.TYPESENSE_HOST?.trim()) {
    errors.push("TYPESENSE_HOST is required");
  }
  if (!process.env.TYPESENSE_API_KEY?.trim()) {
    errors.push("TYPESENSE_API_KEY is required");
  }

  if (isProd) {
    if (!snapshot.adminSecretConfigured) {
      errors.push("ADMIN_SECRET is required in production");
    }
    if (!snapshot.searchEventSaltConfigured) {
      errors.push("SEARCH_EVENT_SALT is required in production");
    }
  }

  const dbHost = databaseUrlHost();
  const tsHost = typesenseHost();
  if (!opts.allowLocal) {
    if (isLocalhostHost(dbHost)) {
      errors.push(
        "DATABASE_URL points at localhost — pass --allow-local to run against a local database",
      );
    }
    if (isLocalhostHost(tsHost)) {
      errors.push(
        "TYPESENSE_HOST points at localhost — pass --allow-local to run against local Typesense",
      );
    }
  }

  if (errors.length > 0 && !opts.force) {
    return { ok: false, snapshot, errors };
  }

  if (errors.length > 0 && opts.force) {
    console.warn(
      JSON.stringify({ event: "ops_environment_force", warnings: errors }, null, 2),
    );
  }

  if (!opts.yes && isProd && !opts.force) {
    return {
      ok: false,
      snapshot,
      errors: [
        ...errors,
        "Production run requires --yes (or set OPS_JOBS_YES=1)",
      ],
    };
  }

  return { ok: true, snapshot };
}

export function parseOpsCliFlags(argv: string[]): EnvironmentGuardOptions {
  return {
    yes: argv.includes("--yes") || process.env.OPS_JOBS_YES === "1",
    allowLocal: argv.includes("--allow-local"),
    force: argv.includes("--force"),
  };
}

export function requireOpsEnvironment(argv: string[]): EnvironmentSnapshot {
  const guard = assertEnvironmentForOps(parseOpsCliFlags(argv));
  printEnvironmentSnapshot(guard.snapshot);
  if (!guard.ok) {
    console.error(JSON.stringify({ event: "ops_environment_abort", errors: guard.errors }, null, 2));
    process.exit(1);
  }
  return guard.snapshot;
}
