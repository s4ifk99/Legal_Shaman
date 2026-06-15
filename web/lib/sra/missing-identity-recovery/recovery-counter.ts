import type {
  MissingIdentityBatchResult,
  RecoveryLadderResult,
} from "@/lib/sra/missing-identity-recovery/types";

/** Per-row summary bucket (debug + batch counters). */
export type RecoveryCounterReason =
  | "recovered_auto_approved"
  | "recovered_pending_review"
  | "unresolved_api_not_found"
  | "unresolved_no_candidates"
  | "unresolved_no_search_results"
  | "unresolved_captcha_blocked"
  | "unresolved_law_society_blocked"
  | "failed_ladder_exception";

export function counterReasonFromLadder(ladder: RecoveryLadderResult): RecoveryCounterReason {
  if (ladder.candidates.length > 0) {
    return ladder.decisionReason === "auto_approved"
      ? "recovered_auto_approved"
      : "recovered_pending_review";
  }

  if (ladder.api404 || ladder.decisionReason === "unresolved_api_not_found") {
    return "unresolved_api_not_found";
  }
  if (
    ladder.captchaBlocked ||
    ladder.decisionReason === "captcha_blocked_no_other_source"
  ) {
    return "unresolved_captcha_blocked";
  }
  if (
    ladder.lawSocietyBlocked ||
    ladder.decisionReason === "law_society_blocked_no_valid_candidates"
  ) {
    return "unresolved_law_society_blocked";
  }
  if (
    ladder.decisionReason === "no_search_results" ||
    ((ladder.yellCalled || ladder.serperCalled) &&
      ladder.yellCandidatesFound === 0 &&
      ladder.serperCandidatesFound === 0 &&
      ladder.localCandidatesFound === 0)
  ) {
    return "unresolved_no_search_results";
  }

  return "unresolved_no_candidates";
}

/** Apply per-source flags from a completed ladder (not outcome buckets). */
export function applyLadderSourceFlags(
  batch: MissingIdentityBatchResult,
  ladder: RecoveryLadderResult,
): void {
  batch.rejectedAddressLike += ladder.rejectedAddressLike;
  batch.addressLikeRejected += ladder.rejectedAddressLike;
  batch.rejectedWeakEvidence += ladder.rejectedWeakEvidence;
  if (ladder.lawSocietySkipped) batch.lawSocietySkipped++;
  for (const source of ladder.scalableSourcesAttempted) {
    if (!batch.scalableSourcesAttempted.includes(source)) {
      batch.scalableSourcesAttempted.push(source);
    }
  }
  if (ladder.localRecovered) batch.localRecovered++;
  if (ladder.yellRecovered) batch.yellRecovered++;
  if (ladder.serperRecovered) batch.serperRecovered++;
  if (ladder.lawSocietyFound) batch.lawSocietyFound++;
  if (ladder.webFound) batch.webFound++;
}

/**
 * Increment batch outcome counters from ladder result only.
 * Never increments `failed` — use `failed_ladder_exception` via applyFailedLadderException.
 */
export function applyCounterReasonToBatch(
  batch: MissingIdentityBatchResult,
  reason: RecoveryCounterReason,
  ladder: RecoveryLadderResult,
): void {
  switch (reason) {
    case "recovered_auto_approved":
      batch.recovered++;
      batch.autoApproved++;
      break;
    case "recovered_pending_review":
      batch.recovered++;
      batch.pendingReview++;
      break;
    case "unresolved_api_not_found":
      batch.unresolved++;
      batch.api404++;
      break;
    case "unresolved_no_candidates":
      batch.unresolved++;
      break;
    case "unresolved_no_search_results":
      batch.unresolved++;
      break;
    case "unresolved_captcha_blocked":
      batch.unresolved++;
      if (ladder.captchaBlocked) batch.captchaBlocked++;
      if (ladder.lawSocietyBlocked) batch.lawSocietyBlocked++;
      break;
    case "unresolved_law_society_blocked":
      batch.unresolved++;
      if (ladder.lawSocietyBlocked) batch.lawSocietyBlocked++;
      if (ladder.captchaBlocked) batch.captchaBlocked++;
      break;
    case "failed_ladder_exception":
      batch.failed++;
      break;
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

export function applyFailedLadderException(batch: MissingIdentityBatchResult): RecoveryCounterReason {
  applyCounterReasonToBatch(batch, "failed_ladder_exception", emptyLadderForCounter());
  return "failed_ladder_exception";
}

function emptyLadderForCounter(): RecoveryLadderResult {
  return {
    sraId: "",
    candidates: [],
    queriesRun: [],
    localQueries: [],
    sraApiQueries: [],
    yellQueries: [],
    serperQueries: [],
    localCandidatesFound: 0,
    yellCandidatesFound: 0,
    serperCandidatesFound: 0,
    yellCalled: false,
    serperCalled: false,
    top3SerperResults: [],
    top3YellResults: [],
    top3Candidates: [],
    candidateRejections: [],
    localRecovered: false,
    sraApiRecovered: false,
    yellRecovered: false,
    serperRecovered: false,
    api404: false,
    lawSocietyFound: false,
    webFound: false,
    scalableSourcesAttempted: [],
    lawSocietySkipped: false,
    lawSocietyBlocked: false,
    captchaBlocked: false,
    rejectedAddressLike: 0,
    rejectedWeakEvidence: 0,
    decisionReason: "failed",
  };
}
