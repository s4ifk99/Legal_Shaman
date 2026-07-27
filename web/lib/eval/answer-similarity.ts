/** Token/bigram similarity for parity eval scripts. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9£$\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function bigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) out.push(`${tokens[i]} ${tokens[i + 1]}`);
  return out;
}

export function answerSimilarity(a: string, b: string): number {
  const left = a.trim();
  const right = b.trim();
  if (!left && !right) return 1;
  if (left === right) return 1;
  const at = tokenize(left);
  const bt = tokenize(right);
  const uni = jaccard(at, bt);
  const bi = jaccard(bigrams(at), bigrams(bt));
  return 0.55 * uni + 0.45 * bi;
}

export function sourceTitleOverlap(localTitles: string[], prodTitles: string[]): number {
  if (!localTitles.length && !prodTitles.length) return 1;
  if (!localTitles.length || !prodTitles.length) return 0;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const L = localTitles.map(norm);
  const P = prodTitles.map(norm);
  let soft = 0;
  for (const l of L) {
    if (P.some((p) => p === l || p.includes(l) || l.includes(p))) soft += 1;
  }
  return soft / Math.max(L.length, P.length);
}

export function combinedParityScore(args: {
  localAnswer: string;
  prodAnswer: string;
  localTitles: string[];
  prodTitles: string[];
  localMode?: string;
  prodMode?: string;
}): { similarity: number; answerSim: number; sourceSim: number; modeMatch: boolean } {
  const answerSim = answerSimilarity(args.localAnswer, args.prodAnswer);
  const sourceSim = sourceTitleOverlap(args.localTitles, args.prodTitles);
  const modeMatch =
    !args.localMode || !args.prodMode ? true : args.localMode === args.prodMode;
  const similarity = 0.65 * answerSim + 0.25 * sourceSim + (modeMatch ? 0.1 : 0);
  return {
    similarity,
    answerSim,
    sourceSim,
    modeMatch,
  };
}
