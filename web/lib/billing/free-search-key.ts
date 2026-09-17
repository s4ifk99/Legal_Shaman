import "server-only";

/** Prefer first non-empty story chunk so blank rawInputs cannot skip quota. */
export function resolveFreeSearchKey(input: {
  rawInputs?: unknown;
  latestText?: unknown;
  whatHappened?: unknown;
  caseKey?: unknown;
}): string {
  const raw = Array.isArray(input.rawInputs) ? input.rawInputs[0] : null;
  const fromRaw = typeof raw === "string" ? raw.trim() : "";
  const latest = String(input.latestText ?? "").trim();
  const happened = String(input.whatHappened ?? "").trim();
  const caseKey = String(input.caseKey ?? "").trim();
  return fromRaw || latest || happened || caseKey;
}
