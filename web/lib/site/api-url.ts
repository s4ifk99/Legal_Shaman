const CANONICAL_HOST = "www.legalshaman.com";

/** Apex hostnames that should call APIs on www to avoid cross-origin 307 redirect failures. */
const APEX_HOSTS = new Set(["legalshaman.com"]);

/**
 * Resolve a same-origin API path to the canonical host when needed.
 * Browser fetch to apex `/api/*` gets a 307 to www, which fails as a cross-origin POST.
 */
export function resolveApiUrl(path: string): string {
  if (!path.startsWith("/")) return path;
  if (typeof window === "undefined") return path;
  const { protocol, hostname, port } = window.location;
  if (!APEX_HOSTS.has(hostname)) return path;
  const host = port ? `${CANONICAL_HOST}:${port}` : CANONICAL_HOST;
  return `${protocol}//${host}${path}`;
}

export function canonicalSiteOrigin(): string {
  if (typeof window !== "undefined" && APEX_HOSTS.has(window.location.hostname)) {
    return `https://${CANONICAL_HOST}`;
  }
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ||
    `https://${CANONICAL_HOST}`
  );
}
