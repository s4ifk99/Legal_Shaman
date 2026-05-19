import type { SearchResult } from "@/lib/legal-search/types";
import type {
  RankingStageSnapshot,
  ResultDebugDiagnostics,
  SearchResponseDebug,
} from "@/lib/legal-search/search-diagnostics-types";

export type RankMovement = {
  id: string;
  title: string;
  source: string;
  rankBefore: number | null;
  rankAfter: number | null;
  delta: number | null;
  finalBefore?: number;
  finalAfter?: number;
  note: string;
};

function rankMapFromStage(stage: RankingStageSnapshot | undefined): Map<string, { rank: number; final: number }> {
  const m = new Map<string, { rank: number; final: number }>();
  if (!stage) return m;
  for (const row of stage.top) {
    m.set(row.id, { rank: row.rank, final: row.final });
  }
  return m;
}

/** Compare two ranking snapshots (e.g. pre-rerank vs post-diversity). */
export function compareRankingStages(
  before: RankingStageSnapshot,
  after: RankingStageSnapshot,
): RankMovement[] {
  const b = rankMapFromStage(before);
  const a = rankMapFromStage(after);
  const ids = new Set<string>([...b.keys(), ...a.keys()]);
  const out: RankMovement[] = [];
  for (const id of ids) {
    const br = b.get(id);
    const ar = a.get(id);
    const title =
      before.top.find((r) => r.id === id)?.title ??
      after.top.find((r) => r.id === id)?.title ??
      id;
    const source =
      before.top.find((r) => r.id === id)?.source ??
      after.top.find((r) => r.id === id)?.source ??
      "";
    const rb = br?.rank ?? null;
    const ra = ar?.rank ?? null;
    let note = "unchanged";
    if (rb != null && ra != null && ra < rb) note = "moved up";
    if (rb != null && ra != null && ra > rb) note = "moved down";
    if (rb == null && ra != null) note = "entered top band";
    if (rb != null && ra == null) note = "left top band";
    out.push({
      id,
      title,
      source,
      rankBefore: rb,
      rankAfter: ra,
      delta: rb != null && ra != null ? rb - ra : null,
      finalBefore: br?.final,
      finalAfter: ar?.final,
      note,
    });
  }
  out.sort((x, y) => Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0));
  return out;
}

/** Human-readable reasons from per-result debug + response-level boosts. */
export function explainResultRanking(
  result: SearchResult,
  searchDebug: SearchResponseDebug | undefined,
): string[] {
  const lines: string[] = [];
  const d = result.debug as ResultDebugDiagnostics | undefined;
  if (!d) {
    lines.push("No per-result debug (run with forceSearchDebug).");
    return lines;
  }
  if (d.originalRankBySource?.preRerank != null) {
    lines.push(`Pre-rerank position: ${d.originalRankBySource.preRerank}`);
  }
  if (d.typesenseScore != null) {
    lines.push(`Typesense text match: ${d.typesenseScore.toFixed(3)}`);
  }
  lines.push(`Keyword score: ${d.keywordScore?.toFixed(3) ?? "—"}`);
  lines.push(`Final model score: ${d.finalScore.toFixed(3)}`);
  if (d.capabilityMatches?.length) {
    lines.push(`Capability matches: ${d.capabilityMatches.join(", ")}`);
  }
  if (searchDebug?.sourceDiversityApplied) {
    lines.push("Source diversity pass applied to top results.");
  }
  if (searchDebug?.legalAidBoostApplied) {
    lines.push(`Legal aid boost: ${searchDebug.legalAidBoostReason ?? "yes"}`);
  }
  return lines;
}
