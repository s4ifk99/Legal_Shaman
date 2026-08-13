import type { MatterFrame, MatterGateResult } from "./types";

/** Matter understanding gate — distinct from evidence sufficiency. */
export function evaluateMatterGate(frame: MatterFrame): MatterGateResult {
  const blocking = frame.ambiguities.filter((a) => a.blocking);
  const blockingAmbiguities = blocking.map((a) => a.question);

  if (
    frame.resolutionStatus === "insufficient_facts" ||
    frame.resolutionStatus === "relationship_uncertain" ||
    blocking.length > 0
  ) {
    return {
      status: "needs_clarification",
      reason: frame.resolutionStatus,
      blockingAmbiguities,
    };
  }

  return { status: "pass", blockingAmbiguities: [] };
}
