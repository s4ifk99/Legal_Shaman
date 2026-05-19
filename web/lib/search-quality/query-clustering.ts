/**
 * Lightweight query clustering for search-quality review (no ML).
 * Normalises phrasing so similar intents group together.
 */

const STOP = new Set([
  "a",
  "an",
  "the",
  "i",
  "my",
  "me",
  "need",
  "help",
  "with",
  "for",
  "to",
  "and",
  "or",
  "is",
  "it",
  "can",
  "get",
  "find",
  "looking",
  "please",
  "lawyer",
  "solicitor",
  "legal",
  "advice",
]);

/** Canonical cluster keys for common employment-loss phrasing. */
const SYNONYM_CLUSTERS: { cluster: string; patterns: RegExp[] }[] = [
  {
    cluster: "employment:job_loss",
    patterns: [
      /\b(lost my job|lost his job|lost her job)\b/i,
      /\b(fired|sacked|dismissed|redundant|redundancy)\b/i,
      /\b(unfair dismissal|wrongful dismissal)\b/i,
    ],
  },
  {
    cluster: "family:divorce_children",
    patterns: [/\b(divorce|child arrangements|custody|contact order)\b/i],
  },
  {
    cluster: "housing:eviction",
    patterns: [/\b(evict|eviction|landlord|section 21|possession)\b/i],
  },
];

export type QueryCluster = {
  normalisedKey: string;
  clusterHint: string | null;
  tokens: string[];
};

export function normaliseQueryForCluster(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/gi, " ")
    .replace(/\s+/g, " ");
}

export function detectClusterHint(normalised: string): string | null {
  for (const { cluster, patterns } of SYNONYM_CLUSTERS) {
    if (patterns.some((p) => p.test(normalised))) return cluster;
  }
  return null;
}

export function tokeniseForCluster(normalised: string): string[] {
  return normalised
    .split(/\s+/)
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter((t) => t.length > 2 && !STOP.has(t));
}

export function clusterQuery(raw: string): QueryCluster {
  const n = normaliseQueryForCluster(raw);
  return {
    normalisedKey: n,
    clusterHint: detectClusterHint(n),
    tokens: tokeniseForCluster(n),
  };
}

/** Merge multiple raw queries into one display label (most frequent normalised). */
export function mergeClusterLabel(queries: string[]): string {
  if (!queries.length) return "";
  const counts = new Map<string, number>();
  for (const q of queries) {
    const k = normaliseQueryForCluster(q);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best || normaliseQueryForCluster(queries[0]!);
}
