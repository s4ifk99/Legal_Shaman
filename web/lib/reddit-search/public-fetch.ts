/** Reddit requires a unique descriptive User-Agent (see reddit.com/dev/api). */
export const REDDIT_USER_AGENT =
  process.env.REDDIT_USER_AGENT?.trim() ||
  "web:legal-shaman:1.0.0 (by /u/legalshaman; OSLAW trending ingest)";

export const REDDIT_PUBLIC_HOSTS = ["old.reddit.com", "www.reddit.com"] as const;

const FETCH_TIMEOUT_MS = 20_000;

export async function fetchRedditPublic(
  path: string,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const errors: string[] = [];

  for (const host of REDDIT_PUBLIC_HOSTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`https://${host}${normalizedPath}`, {
        headers: { "User-Agent": REDDIT_USER_AGENT },
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.ok) return response;
      errors.push(`${host}: HTTP ${response.status}`);
    } catch (err) {
      errors.push(
        `${host}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(errors.join("; ") || "reddit_unreachable");
}
