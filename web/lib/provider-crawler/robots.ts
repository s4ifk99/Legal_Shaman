const USER_AGENT = "LegalShaman-Crawler/1.0 (+https://legalshaman.org; compliant enrichment)";

type RobotsRules = {
  fetchedAt: number;
  disallow: { agent: string; paths: string[] }[];
};

const cache = new Map<string, RobotsRules>();
const CACHE_TTL_MS = 60 * 60 * 1000;

function parseRobotsTxt(body: string): RobotsRules["disallow"] {
  const blocks: { agent: string; paths: string[] }[] = [];
  let currentAgents: string[] = [];
  let currentPaths: string[] = [];

  const flush = () => {
    if (currentAgents.length && currentPaths.length) {
      for (const agent of currentAgents) {
        blocks.push({ agent: agent.toLowerCase(), paths: [...currentPaths] });
      }
    }
    currentAgents = [];
    currentPaths = [];
  };

  for (const line of body.split("\n")) {
    const trimmed = line.split("#")[0]?.trim() ?? "";
    if (!trimmed) continue;
    const [key, ...rest] = trimmed.split(":");
    const value = rest.join(":").trim();
    const k = key?.toLowerCase();

    if (k === "user-agent") {
      if (currentPaths.length) flush();
      currentAgents.push(value || "*");
    } else if (k === "disallow" && value) {
      currentPaths.push(value);
    }
  }
  flush();
  return blocks;
}

async function loadRobots(origin: string): Promise<RobotsRules | null> {
  if (process.env.PROVIDER_CRAWL_SKIP_FETCH === "1") return null;

  const cached = cache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const body = await res.text();
    const rules: RobotsRules = {
      fetchedAt: Date.now(),
      disallow: parseRobotsTxt(body),
    };
    cache.set(origin, rules);
    return rules;
  } catch {
    return null;
  }
}

function agentMatches(ruleAgent: string, ua: string): boolean {
  if (ruleAgent === "*") return true;
  return ua.toLowerCase().includes(ruleAgent);
}

export function pathDisallowed(pathname: string, disallowed: string): boolean {
  if (!disallowed) return false;
  if (disallowed === "/") return true;
  return pathname === disallowed || pathname.startsWith(disallowed);
}

/** Deterministic robots check (for tests and cached rules). */
export function isPathAllowedByRules(
  pathname: string,
  disallowPaths: string[],
  userAgent = USER_AGENT,
): boolean {
  for (const p of disallowPaths) {
    if (pathDisallowed(pathname, p)) return false;
  }
  return true;
}

/**
 * Returns whether fetching `url` is allowed per robots.txt for our crawler UA.
 * When robots cannot be loaded, allows fetch (fail-open for missing robots only).
 */
export async function isUrlAllowedByRobots(
  url: string,
  userAgent = USER_AGENT,
): Promise<{ allowed: boolean; reason?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: "invalid_url" };
  }

  const rules = await loadRobots(parsed.origin);
  if (!rules) return { allowed: true };

  const pathname = parsed.pathname || "/";
  for (const block of rules.disallow) {
    if (!agentMatches(block.agent, userAgent)) continue;
    for (const p of block.paths) {
      if (pathDisallowed(pathname, p)) {
        return { allowed: false, reason: `robots_disallow:${p}` };
      }
    }
  }
  return { allowed: true };
}

export { USER_AGENT as CRAWLER_USER_AGENT };
