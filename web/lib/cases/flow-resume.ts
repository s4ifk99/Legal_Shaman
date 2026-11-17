import type { FlowState } from "@/lib/cases/flow";

export const FLOW_RESUME_KEY = "ls_v3_flow_resume";
export const CASE_SNAPSHOT_KEY = "ls_v3_case_snapshot";
export const RESULTS_INTENT_KEY = "ls_v3_results_intent";

export type FlowResumePayload = {
  state: FlowState;
  caseId: string | null;
  savedAt: string;
};

export function saveFlowResume(state: FlowState, caseId: string | null): void {
  try {
    const payload: FlowResumePayload = {
      state,
      caseId,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(FLOW_RESUME_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function loadFlowResume(): FlowResumePayload | null {
  try {
    const raw = localStorage.getItem(FLOW_RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FlowResumePayload;
    if (!parsed?.state?.phase || !Array.isArray(parsed.state.messages)) return null;
    // Older snapshots may lack UC rights index — keep resume safe.
    if (typeof parsed.state.ucRightsQIndex !== "number") {
      parsed.state.ucRightsQIndex = 0;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearFlowResume(): void {
  try {
    localStorage.removeItem(FLOW_RESUME_KEY);
  } catch {
    /* ignore */
  }
}

export function markResultsIntent(): void {
  try {
    sessionStorage.setItem(RESULTS_INTENT_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function consumeResultsIntent(): boolean {
  try {
    const v = sessionStorage.getItem(RESULTS_INTENT_KEY);
    if (!v) return false;
    sessionStorage.removeItem(RESULTS_INTENT_KEY);
    return true;
  } catch {
    return false;
  }
}
