import "server-only";

import type { Candidate } from "@/lib/lawyers/search";

function candidateKey(c: Candidate): string {
  return c.kind === "lawyer" ? `lawyer:${c.lawyer.id}` : `org:${c.org.id}`;
}

function mergeSources(a: Candidate["sources"], b: Candidate["sources"]): Candidate["sources"] {
  return [...new Set([...a, ...b])];
}

function betterDistance(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return a <= b ? a : b;
}

/** Merge Postgres hybrid recall with supplemental Typesense candidates (dedupe by id). */
export function mergeMatcherCandidates(
  postgres: Candidate[],
  typesense: Candidate[],
): Candidate[] {
  const map = new Map<string, Candidate>();

  for (const c of postgres) {
    map.set(candidateKey(c), c);
  }

  for (const c of typesense) {
    const key = candidateKey(c);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, c);
      continue;
    }
    map.set(key, {
      ...prev,
      sources: mergeSources(prev.sources, c.sources),
      cosineDistance: betterDistance(prev.cosineDistance, c.cosineDistance),
    });
  }

  return [...map.values()];
}
