/** Local / docker-compose Typesense hosts typically speak plain HTTP on 8108. */
export function isLocalTypesenseHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "typesense" ||
    h.endsWith(".local")
  );
}

export type TypesenseNodeConfig = {
  host: string;
  port: number;
  protocol: "http" | "https";
};

export function resolveTypesenseNodeConfig(): TypesenseNodeConfig | null {
  const host = process.env.TYPESENSE_HOST?.trim();
  const apiKey = process.env.TYPESENSE_API_KEY?.trim();
  if (!host || !apiKey) return null;

  const explicitProtocol = process.env.TYPESENSE_PROTOCOL?.trim().toLowerCase();
  let protocol: "http" | "https";
  if (explicitProtocol === "http" || explicitProtocol === "https") {
    protocol = explicitProtocol;
  } else if (isLocalTypesenseHost(host)) {
    protocol = "http";
  } else {
    protocol = "https";
  }

  const portStr = process.env.TYPESENSE_PORT?.trim();
  let port: number;
  if (portStr) {
    const parsed = Number.parseInt(portStr, 10);
    port = Number.isFinite(parsed) ? parsed : protocol === "https" ? 443 : 8108;
  } else {
    port = protocol === "https" ? 443 : 8108;
  }

  return { host, port, protocol };
}

/** Actionable hint when Typesense TLS handshake fails (HTTPS client → HTTP server). */
export function typesenseTlsErrorHint(error: unknown): string | null {
  const msg = error instanceof Error ? error.message : String(error);
  if (!/EPROTO|SSL routines|packet length too long|wrong version number/i.test(msg)) {
    return null;
  }
  const node = resolveTypesenseNodeConfig();
  if (!node) return "Set TYPESENSE_PROTOCOL=http and TYPESENSE_PORT=8108 for local Typesense.";
  if (node.protocol === "https" && (isLocalTypesenseHost(node.host) || node.port === 8108)) {
    return `Typesense at ${node.host}:${node.port} is likely HTTP-only. Set TYPESENSE_PROTOCOL=http and TYPESENSE_PORT=8108 in .env.local.`;
  }
  return "Check TYPESENSE_PROTOCOL / TYPESENSE_PORT match your Typesense server (local default: http:8108).";
}

export function formatDatabaseConnectivityError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: string }).code)
      : "";

  if (code === "ETIMEDOUT" || /ETIMEDOUT|connection timed out/i.test(msg)) {
    return [
      "Database connection timed out (ETIMEDOUT).",
      "Check DATABASE_URL in .env.local, VPN/network access to Postgres, and that the database is running.",
      "Optional: raise DATABASE_CONNECT_TIMEOUT_MS (default 30000).",
    ].join(" ");
  }

  if (/ECONNREFUSED|ENOTFOUND/i.test(msg) || code === "ECONNREFUSED" || code === "ENOTFOUND") {
    return [
      "Database is unreachable.",
      "Verify DATABASE_URL host/port and that Postgres accepts connections from this machine.",
    ].join(" ");
  }

  return msg;
}
