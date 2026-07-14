/** Shared thresholds for hybrid rule + LLM legal classification (no server-only). */

export const LLM_CLASSIFY_ACCEPT_THRESHOLD = 0.55;

export function legalClassifyRuleStrongThreshold(): number {
  const raw = process.env.LEGAL_CLASSIFY_LLM_THRESHOLD?.trim();
  const n = raw ? Number(raw) : 0.14;
  return Number.isFinite(n) && n >= 0 ? n : 0.14;
}

export function enableLlmLegalClassificationFlag(): boolean {
  const raw = process.env.ENABLE_LLM_LEGAL_CLASSIFICATION?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  return true;
}
