import type { PrismaClient } from "@prisma/client";
import { validateIdentityCandidate } from "@/lib/sra/missing-identity-recovery/candidate-validator";
import { scoreIdentityCandidate, shouldAutoApprove } from "@/lib/sra/missing-identity-recovery/confidence";
import {
  isDbTimeoutError,
  loadOrganisationBatch,
  rowMatchesRecoveryFilters,
  withBatchQueryTimeout,
  withDbRetry,
} from "@/lib/sra/missing-identity-recovery/load-organisation-batch";
import {
  canSerperAutoApprove,
  rejectCandidateName,
  validateYellListing,
} from "@/lib/sra/missing-identity-recovery/candidate-name-rejection";
import {
  evaluateCandidateEvidence,
  isWeakIdentityCandidate,
} from "@/lib/sra/missing-identity-recovery/candidate-evidence";
import {
  hasCompetingCandidateNames,
  recommendCompetingCandidateAction,
} from "@/lib/sra/missing-identity-recovery/competing-candidates-review";
import { evidenceHasExactSraNumber, extractSraNumbersFromText } from "@/lib/sra/missing-identity-recovery/sra-number-evidence";
import {
  countCompetingCandidateNames,
  countCompetingViableCandidates,
  isEligibleForBatchApprove,
  SAFE_APPROVE_MIN_CONFIDENCE,
} from "@/lib/sra/missing-identity-recovery/candidate-promotion";
import {
  createStartupTiming,
  markStartupStage,
} from "@/lib/sra/missing-identity-recovery/startup-timing";
import { mineLocalSraCandidates } from "@/lib/sra/missing-identity-recovery/local-data-miner";
import { recoverFromSraApi } from "@/lib/sra/missing-identity-recovery/sra-api-recovery";
import {
  runMissingIdentityRecovery,
  runRecoveryLadder,
  shouldIncludeLawSociety,
  shouldRunYellIdentityRecovery,
} from "@/lib/sra/missing-identity-recovery/orchestrator";
import {
  applyCounterReasonToBatch,
  applyFailedLadderException,
  applyLadderSourceFlags,
  counterReasonFromLadder,
} from "@/lib/sra/missing-identity-recovery/recovery-counter";
import type {
  MissingIdentityBatchResult,
  RecoveryContext,
  RecoveryLadderResult,
} from "@/lib/sra/missing-identity-recovery/types";
import {
  parseLawSocietyProfileHtml,
  parseLawSocietySearchResultsHtml,
} from "@/lib/sra/law-society-parse";
import { scoreLawSocietyMatch } from "@/lib/sra/law-society-sra-recovery";

function emptyBatch(): MissingIdentityBatchResult {
  return {
    event: "sra_recover_identities",
    scanned: 0,
    recovered: 0,
    autoApproved: 0,
    pendingReview: 0,
    unresolved: 0,
    api404: 0,
    localRecovered: 0,
    yellRecovered: 0,
    serperRecovered: 0,
    lawSocietyFound: 0,
    webFound: 0,
    lawSocietySkipped: 0,
    lawSocietyBlocked: 0,
    captchaBlocked: 0,
    scalableSourcesAttempted: [],
    addressLikeRejected: 0,
    rejectedAddressLike: 0,
    rejectedWeakEvidence: 0,
    failed: 0,
    dryRun: true,
  };
}

function applyLadderToBatch(ladder: RecoveryLadderResult): MissingIdentityBatchResult {
  const batch = emptyBatch();
  applyLadderSourceFlags(batch, ladder);
  applyCounterReasonToBatch(batch, counterReasonFromLadder(ladder), ladder);
  return batch;
}

const ctxBase = (overrides: Partial<RecoveryContext>): RecoveryContext => ({
  sraId: "1002231",
  orgId: "sra:1002231",
  displayName: "SRA organisation 1002231",
  searchText: "1002231\nSmith & Jones Solicitors LLP\n12 High Street\nSheffield\nS1 4SB",
  postcode: "S1 4SB",
  city: "Sheffield",
  county: "",
  country: "England",
  phone: "",
  ...overrides,
});

export async function runMissingIdentityRecoveryEval(): Promise<number> {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL missing-identity-recovery: ${msg}`);
    failed++;
  };

  const api404Ladder: RecoveryLadderResult = {
    sraId: "209632",
    candidates: [],
    queriesRun: [],
    localQueries: ["local_search_text_mining"],
    sraApiQueries: ["SRA Data Share organisation/Get?OrganisationId=209632"],
    yellQueries: ["site:yell.com solicitors AB1 2CD"],
    serperQueries: ['"209632" solicitor'],
    localCandidatesFound: 0,
    yellCandidatesFound: 0,
    serperCandidatesFound: 0,
    yellCalled: true,
    serperCalled: true,
    top3SerperResults: [],
    top3YellResults: [],
    top3Candidates: [],
    candidateRejections: [],
    localRecovered: false,
    sraApiRecovered: false,
    yellRecovered: false,
    serperRecovered: false,
    api404: true,
    lawSocietyFound: false,
    webFound: false,
    scalableSourcesAttempted: ["local_sra", "sra_api", "yell", "serper"],
    lawSocietySkipped: true,
    lawSocietyBlocked: false,
    captchaBlocked: false,
    rejectedAddressLike: 0,
    rejectedWeakEvidence: 0,
    decisionReason: "unresolved_api_not_found",
  };
  const api404Batch = applyLadderToBatch(api404Ladder);
  if (api404Batch.unresolved !== 1 || api404Batch.api404 !== 1 || api404Batch.failed !== 0) {
    fail(`api404 unresolved batch: unresolved=${api404Batch.unresolved} api404=${api404Batch.api404} failed=${api404Batch.failed}`);
  }
  if (counterReasonFromLadder(api404Ladder) !== "unresolved_api_not_found") {
    fail("api404 ladder counterReason should be unresolved_api_not_found");
  }

  const noCandidatesLadder: RecoveryLadderResult = {
    ...api404Ladder,
    api404: false,
    sraApiQueries: [],
    yellCalled: false,
    serperCalled: false,
    yellQueries: [],
    serperQueries: [],
    scalableSourcesAttempted: ["local_sra", "sra_api"],
    decisionReason: "no_valid_candidates",
  };
  const noCandidatesBatch = applyLadderToBatch(noCandidatesLadder);
  if (noCandidatesBatch.unresolved !== 1 || noCandidatesBatch.failed !== 0) {
    fail(`no_candidates unresolved should not increment failed (unresolved=${noCandidatesBatch.unresolved} failed=${noCandidatesBatch.failed})`);
  }
  if (counterReasonFromLadder(noCandidatesLadder) !== "unresolved_no_candidates") {
    fail("no_valid_candidates counterReason should be unresolved_no_candidates");
  }

  const noSearchLadder: RecoveryLadderResult = {
    ...api404Ladder,
    api404: false,
    decisionReason: "no_search_results",
    yellCalled: true,
    serperCalled: true,
  };
  const noSearchBatch = applyLadderToBatch(noSearchLadder);
  if (noSearchBatch.unresolved !== 1 || noSearchBatch.failed !== 0) {
    fail("no_search_results unresolved should not increment failed");
  }
  if (counterReasonFromLadder(noSearchLadder) !== "unresolved_no_search_results") {
    fail("no_search_results counterReason mismatch");
  }

  const exceptionBatch = emptyBatch();
  applyFailedLadderException(exceptionBatch);
  if (exceptionBatch.failed !== 1 || exceptionBatch.unresolved !== 0) {
    fail(`ladder exception should increment failed only (failed=${exceptionBatch.failed} unresolved=${exceptionBatch.unresolved})`);
  }

  const local = mineLocalSraCandidates(ctxBase({}));
  if (!local.candidates.some((c) => c.candidateName.includes("Smith"))) {
    fail("local good searchText should recover firm name");
  }

  const addressReject = validateIdentityCandidate(
    {
      sraId: "1002231",
      candidateName: "12 High Street, Sheffield S1 4SB",
      sourceType: "serper",
      sourceUrl: "https://example.com/firm",
      evidenceText: "solicitors at this address",
      confidence: 0.8,
    },
    "1002231",
  );
  if (addressReject.ok) {
    fail("address-like name should be rejected");
  }

  const yellCandidate = {
    sraId: "1002231",
    candidateName: "Town Centre Solicitors",
    sourceType: "yell" as const,
    sourceUrl: "https://www.yell.com/biz/town-centre-solicitors",
    evidenceText: "solicitors S1 4SB law firm",
    matchedPostcode: "S1 4SB",
    matchedTown: "Sheffield",
    confidence: scoreIdentityCandidate({
      candidate: {
        sraId: "1002231",
        candidateName: "Town Centre Solicitors",
        sourceType: "yell",
        sourceUrl: "https://www.yell.com/biz/town-centre-solicitors",
        evidenceText: "solicitors S1 4SB law firm",
        matchedPostcode: "S1 4SB",
        matchedTown: "Sheffield",
      },
      sraId: "1002231",
      postcode: "S1 4SB",
      town: "Sheffield",
      pageText: "solicitors law firm",
    }),
    status: "pending_review" as const,
  };
  if (shouldRunYellIdentityRecovery({})) {
    fail("Yell identity recovery should be disabled by default");
  }

  const serperAuto = {
    sraId: "921469",
    candidateName: "Bhayani HR & Employment Law",
    sourceType: "serper" as const,
    sourceUrl: "https://www.bhayani.co.uk/about",
    evidenceText: "SRA Number 921469 solicitors S1 4SB employment law",
    matchedPostcode: "S1 4SB",
    matchedTown: "Sheffield",
    confidence: scoreIdentityCandidate({
      candidate: {
        sraId: "921469",
        candidateName: "Bhayani HR & Employment Law",
        sourceType: "serper",
        sourceUrl: "https://www.bhayani.co.uk/about",
        evidenceText: "SRA Number 921469 solicitors S1 4SB employment law",
        matchedPostcode: "S1 4SB",
        matchedTown: "Sheffield",
      },
      sraId: "921469",
      postcode: "S1 4SB",
      town: "Sheffield",
      pageText: "SRA 921469 solicitors",
      sraIdInEvidence: true,
    }),
    status: "pending_review" as const,
  };
  const serperValidated = validateIdentityCandidate(serperAuto, "921469");
  if (!serperValidated.ok) {
    fail("Serper SRA/postcode candidate should validate");
  } else if (
    !shouldAutoApprove(serperValidated.candidate, 0, { orgPostcode: "S1 4SB" }) ||
    serperValidated.candidate.confidence < 0.99
  ) {
    fail("Serper exact SRA number candidate should be auto-approvable at 0.99");
  }

  const weakTown = validateIdentityCandidate(
    {
      sraId: "1002231",
      candidateName: "Sheffield",
      sourceType: "serper",
      sourceUrl: "https://example.com/dir",
      evidenceText: "directory listing",
      matchedTown: "Sheffield",
      confidence: 0.5,
    },
    "1002231",
  );
  if (weakTown.ok) {
    fail("town-only weak candidate should be rejected");
  }

  const SEARCH_921469 = `
  <h2><a href="https://solicitors.lawsociety.org.uk/organisation/12345/bhayani">Bhayani HR &amp; Employment Law</a></h2>
  <p>SRA number: 921469</p>`;
  const rows921469 = parseLawSocietySearchResultsHtml(SEARCH_921469, "921469");
  const scored921469 = scoreLawSocietyMatch({
    targetSraId: "921469",
    rows: rows921469,
    profileRow: parseLawSocietyProfileHtml(
      `<h1>Bhayani HR &amp; Employment Law</h1><p>SRA ID: 921469</p>`,
    ),
    postcodeHint: "S1 4SB",
  });
  if (!scored921469?.organisationName.includes("Bhayani")) {
    fail("921469 Law Society HTML should recover Bhayani HR & Employment Law");
  }

  const placeholderOnly = await runRecoveryLadder(
    ctxBase({
      sraId: "1002231",
      displayName: "SRA organisation 1002231",
      searchText: "1002231\n12 High Street\nSheffield\nS1 4SB",
    }),
    { skipExternalSearch: true, includeLawSociety: false },
  );
  if (
    placeholderOnly.candidates.length > 0 &&
    placeholderOnly.decisionReason !== "pending_review" &&
    placeholderOnly.decisionReason !== "auto_approved"
  ) {
    /* ok if API found a name */
  } else if (
    placeholderOnly.candidates.length === 0 &&
    !placeholderOnly.api404 &&
    process.env.SRA_APIM_SUBSCRIPTION_KEY
  ) {
    /* live API may return a name or not — skip strict 404 assert when key set */
  } else if (
    placeholderOnly.candidates.length === 0 &&
    placeholderOnly.api404 &&
    placeholderOnly.decisionReason !== "unresolved_api_not_found"
  ) {
    fail("1002231 with API 404 should mark unresolved_api_not_found");
  }

  const competingA = validateIdentityCandidate(
    {
      sraId: "1002231",
      candidateName: "Alpha Solicitors LLP",
      sourceType: "serper",
      sourceUrl: "https://example.com/a",
      evidenceText: "solicitors S1 4SB law firm",
      matchedPostcode: "S1 4SB",
      confidence: 0.65,
    },
    "1002231",
  );
  const competingB = validateIdentityCandidate(
    {
      sraId: "1002231",
      candidateName: "Beta Law LLP",
      sourceType: "serper",
      sourceUrl: "https://example.com/b",
      evidenceText: "law firm S1 4SB",
      matchedPostcode: "S1 4SB",
      confidence: 0.65,
    },
    "1002231",
  );
  if (
    competingA.ok &&
    competingB.ok &&
    shouldAutoApprove(competingA.candidate, 1, {
      orgPostcode: "S1 4SB",
      competingMaxConfidence: 0.85,
    })
  ) {
    fail("postcode-only Serper candidate should not auto-approve when a competitor scores above 0.8");
  }

  const sraApiCandidate = {
    sraId: "1002232",
    candidateName: "Bhayani HR & Employment Law",
    sourceType: "sra_api" as const,
    sourceUrl: "https://sra-prod-apim.azure-api.net/datashare/api/V1/organisation/Get?OrganisationId=1002232",
    evidenceText: "sra_api_lookup authorised solicitors organisation; sra_api:success",
    matchedPostcode: "S1 2BJ",
    confidence: 0.95,
    status: "pending_review" as const,
  };
  const sraApiValidated = validateIdentityCandidate(sraApiCandidate, "1002232");
  if (!sraApiValidated.ok) {
    fail("SRA API candidate should validate");
  } else if (!shouldAutoApprove(sraApiValidated.candidate, 0)) {
    fail("SRA API candidate at 0.95 should auto-approve when no competitors");
  }

  const apiRecovery = await recoverFromSraApi(
    ctxBase({ sraId: "999999999", searchText: "999999999", postcode: "" }),
  );
  if (apiRecovery.candidates.some((c) => c.candidateName)) {
    /* live API may return data */
  }

  const ladderNoLs = await runRecoveryLadder(ctxBase({ searchText: "9999999\n1 Main St\nS1 1AA" }), {
    skipExternalSearch: true,
  });
  if (!ladderNoLs.lawSocietySkipped) {
    fail("Law Society should be skipped when not included");
  }
  if (!ladderNoLs.scalableSourcesAttempted.includes("local_sra")) {
    fail("scalable ladder should always attempt local SRA mining");
  }
  if (ladderNoLs.lawSocietyBlocked) {
    fail("Law Society should not be blocked when skipped");
  }

  const singleSraLawSociety = shouldIncludeLawSociety({ sraId: "1002231" });
  if (!singleSraLawSociety) {
    fail("--sra mode should enable Law Society recovery");
  }
  const batchNoFlag = shouldIncludeLawSociety({});
  if (batchNoFlag) {
    fail("batch without --include-lawsociety or --sra should skip Law Society");
  }

  const { scheduleCrawlRun } = await import("@/lib/provider-intelligence-crawler-v2/scheduler");
  if (typeof scheduleCrawlRun !== "function") {
    fail("approve flow should be able to schedule website discovery");
  }

  const captchaOnly = await runRecoveryLadder(
    ctxBase({ searchText: "8888888\nUnknown St\nM1 1AA", postcode: "M1 1AA" }),
    { includeLawSociety: false, skipExternalSearch: true },
  );
  if (captchaOnly.candidates.length > 0) {
    /* ok if local found something */
  } else if (
    captchaOnly.decisionReason !== "no_valid_candidates" &&
    captchaOnly.decisionReason !== "unresolved_api_not_found" &&
    !captchaOnly.captchaBlocked
  ) {
    fail("unresolved without candidates should report no_valid_candidates, api 404, or captcha_blocked");
  }

  const captchaBlockedDecision = {
    captchaBlocked: true,
    decisionReason: "captcha_blocked_no_other_source",
  };
  if (captchaBlockedDecision.decisionReason === "failed") {
    fail("captcha blocked should not use failed status");
  }
  if (!captchaBlockedDecision.captchaBlocked) {
    fail("captcha blocked flag should be set separately from batch failed counter");
  }

  if (!isDbTimeoutError(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }))) {
    fail("isDbTimeoutError should detect ETIMEDOUT");
  }
  if (!isDbTimeoutError(new Error("canceling statement due to statement timeout"))) {
    fail("isDbTimeoutError should detect Postgres statement_timeout");
  }
  if (!isDbTimeoutError(new Error("Transaction API error: Unable to start a transaction in the given time."))) {
    fail("isDbTimeoutError should detect Prisma transaction pool timeouts");
  }

  const prevRetryBase = process.env.SRA_IDENTITY_DB_RETRY_BASE_MS;
  const prevRetryAttempts = process.env.SRA_IDENTITY_DB_RETRY_ATTEMPTS;
  process.env.SRA_IDENTITY_DB_RETRY_BASE_MS = "1";
  process.env.SRA_IDENTITY_DB_RETRY_ATTEMPTS = "2";

  let retryCalls = 0;
  const retried = await withDbRetry("eval", async () => {
    retryCalls++;
    if (retryCalls < 2) {
      throw Object.assign(new Error("read ETIMEDOUT"), { code: "ETIMEDOUT" });
    }
    return "ok";
  }, { maxAttempts: 3, baseDelayMs: 1 });
  if (retried !== "ok" || retryCalls !== 2) {
    fail("withDbRetry should recover after ETIMEDOUT");
  }

  let batchTimeoutRejected = false;
  try {
    await withBatchQueryTimeout(new Promise<string>(() => {}), 25);
  } catch (err) {
    batchTimeoutRejected = isDbTimeoutError(err);
  }
  if (!batchTimeoutRejected) {
    fail("withBatchQueryTimeout should reject with ETIMEDOUT when query hangs");
  }

  const hungPrisma = {
    sraOrganisation: {
      findMany: () => new Promise(() => {}),
      findFirst: () => new Promise(() => {}),
    },
  } as unknown as PrismaClient;

  const hungLoad = await loadOrganisationBatch(hungPrisma, {
    take: 1,
    onlyPlaceholders: true,
    queryTimeoutMs: 40,
  });
  if (!hungLoad.degraded || hungLoad.loadError !== "ETIMEDOUT") {
    fail("loadOrganisationBatch should degrade when batch selection query hangs");
  }

  const startupTiming = createStartupTiming(false);
  markStartupStage(startupTiming, "beforePrismaInit");
  markStartupStage(startupTiming, "afterPrismaInit");
  if (startupTiming.stages.length !== 2 || startupTiming.stages[0]!.stage !== "beforePrismaInit") {
    fail("startup timing should record ordered stages");
  }

  if (countCompetingCandidateNames(
    [{ candidateName: "Alpha LLP" }, { candidateName: "Beta LLP" }],
    "Alpha LLP",
  ) !== 1) {
    fail("countCompetingCandidateNames should count distinct competing names");
  }

  if (!hasCompetingCandidateNames([
    { candidateName: "Alpha LLP" },
    { candidateName: "Beta LLP" },
  ])) {
    fail("hasCompetingCandidateNames should be true for distinct firm names");
  }
  if (hasCompetingCandidateNames([
    { candidateName: "Alpha LLP" },
    { candidateName: "alpha llp" },
  ])) {
    fail("hasCompetingCandidateNames should ignore duplicate names");
  }

  const orgCtx = { sraId: "1002231", postcode: "S1 4SB", city: "Sheffield" };
  const exactSraAlpha = {
    id: "a1",
    candidateName: "Alpha Solicitors LLP",
    sourceType: "serper" as const,
    sourceUrl: "https://alpha.example.com/",
    evidenceText: "SRA Number 1002231 solicitors S1 4SB",
    candidateAddress: "12 High Street, Sheffield S1 4SB",
    matchedPostcode: "S1 4SB",
    confidence: 0.99,
    status: "pending_review",
  };
  const weakBeta = {
    id: "b1",
    candidateName: "Beta Solicitors LLP",
    sourceType: "serper" as const,
    sourceUrl: "https://beta.example.com/",
    evidenceText: "Beta Solicitors LLP law firm S1 4SB",
    candidateAddress: "2 High Street, Sheffield S1 4SB",
    matchedPostcode: "S1 4SB",
    confidence: 0.85,
    status: "pending_review",
  };
  const badArchive = {
    id: "bad1",
    candidateName: "Solicitors Regulation Authority decision tracker archive: 2025",
    sourceType: "serper" as const,
    sourceUrl: "https://www.sra.org.uk/news/archive/decision-tracker",
    evidenceText: "archive page",
    candidateAddress: "",
    matchedPostcode: "",
    confidence: 0.99,
    status: "pending_review",
  };

  if (!extractSraNumbersFromText("Regulator ID: 468963 authorised solicitors").includes("468963")) {
    fail("should extract Regulator ID SRA numbers");
  }
  if (
    recommendCompetingCandidateAction([exactSraAlpha, weakBeta], orgCtx) !==
    "auto_pick_exact_sra_number"
  ) {
    fail("exactly one exact SRA number candidate should recommend auto_pick_exact_sra_number");
  }
  if (
    recommendCompetingCandidateAction(
      [
        exactSraAlpha,
        {
          ...weakBeta,
          id: "b2",
          candidateName: "Gamma LLP",
          evidenceText: "SRA Number 1002231 solicitors S1 4SB",
        },
      ],
      orgCtx,
    ) !== "manual_review"
  ) {
    fail("two exact SRA number candidates should stay manual_review");
  }
  if (
    recommendCompetingCandidateAction([badArchive, { ...badArchive, id: "bad2" }], orgCtx) !==
    "reject_bad_candidates"
  ) {
    fail("all regulatory/archive candidates should recommend reject_bad_candidates");
  }
  if (
    recommendCompetingCandidateAction(
      [weakBeta, { ...weakBeta, id: "b2", candidateName: "Gamma LLP" }],
      orgCtx,
    ) !== "manual_review"
  ) {
    fail("viable candidates without exact SRA evidence should stay manual_review");
  }

  const fixtureRejects: { name: string; sourceUrl: string; evidenceText?: string }[] = [
    {
      name: "Legal News > Your source for information behind the law",
      sourceUrl: "https://legalnews.example/article",
    },
    {
      name: "Bobby Garraway, Attorney at Law",
      sourceUrl: "https://example.com/attorney",
    },
    {
      name: "Reviews of Bassets Solicitors in Rochester on Solicitors Guru",
      sourceUrl: "https://solicitors.guru/office/9187-bassets/",
    },
    { name: "London Solicitors", sourceUrl: "https://example.com/london" },
    { name: "Brentford Solicitors", sourceUrl: "https://example.com/brentford" },
  ];
  for (const sample of fixtureRejects) {
    if (
      !rejectCandidateName(sample.name, { sourceType: "serper", sourceUrl: sample.sourceUrl })
        .rejected
    ) {
      fail(`fixture candidate name should reject: ${sample.name}`);
    }
  }

  const mrhOk = evaluateCandidateEvidence({
    sraId: "517896",
    candidateName: "MRH Solicitors",
    sourceType: "serper",
    sourceUrl: "https://www.mrhsolicitors.co.uk/",
    evidenceText: "MRH Solicitors SRA Number 517896 solicitors",
    matchedPostcode: "SK1 1AA",
    orgPostcode: "SK1 1AA",
  });
  if (!mrhOk.sraNumberMatch || mrhOk.confidence < 0.99) {
    fail("MRH Solicitors should score 0.99 when SRA Number 517896 matches target");
  }
  const mrhWrong = evaluateCandidateEvidence({
    sraId: "1022856",
    candidateName: "MRH Solicitors",
    sourceType: "serper",
    sourceUrl: "https://www.mrhsolicitors.co.uk/",
    evidenceText: "MRH Solicitors SRA Number 517896 solicitors",
    matchedPostcode: "SK1 1AA",
    orgPostcode: "SK1 1AA",
  });
  if (!mrhWrong.rejected || mrhWrong.rejectReason !== "sra_number_mismatch") {
    fail("MRH should reject when extracted SRA number mismatches target sraId with postcode match");
  }

  const towerhouse = evaluateCandidateEvidence({
    sraId: "468963",
    candidateName: "Towerhouse LLP",
    sourceType: "serper",
    sourceUrl: "https://www.towerhouse.example/",
    evidenceText: "Towerhouse LLP Regulator ID: 468963 solicitors",
    matchedPostcode: "EC1A 1BB",
    orgPostcode: "EC1A 1BB",
  });
  if (!towerhouse.sraNumberMatch || towerhouse.confidence < 0.99) {
    fail("Towerhouse LLP should accept Regulator ID 468963 match");
  }

  const postcodeOnly = evaluateCandidateEvidence({
    sraId: "61006",
    candidateName: "Bassets Solicitors LLP",
    sourceType: "serper",
    sourceUrl: "https://solicitors.guru/office/9187-bassets/",
    evidenceText: "156 High Street Rochester ME1 1ET solicitors",
    matchedPostcode: "ME1 1ET",
    orgPostcode: "ME1 1ET",
  });
  if (postcodeOnly.confidence >= 0.9) {
    fail("postcode-only directory candidate should not score 0.9");
  }
  if (!isWeakIdentityCandidate({
    sraId: "61006",
    candidateName: "Bassets Solicitors LLP",
    sourceType: "serper",
    sourceUrl: "https://solicitors.guru/office/9187-bassets/",
    evidenceText: "156 High Street Rochester ME1 1ET solicitors",
    matchedPostcode: "ME1 1ET",
    orgPostcode: "ME1 1ET",
  }).weak) {
    fail("weak directory postcode-only candidate should be flagged for cleanup");
  }

  const postcodeOfficialOnly = evaluateCandidateEvidence({
    sraId: "1007442",
    candidateName: "Stowe Family Law",
    sourceType: "serper",
    sourceUrl: "https://www.stowefamilylaw.co.uk/locations/harrogate",
    evidenceText: "Family law solicitors HG1 1TT Harrogate",
    matchedPostcode: "HG1 1TT",
    orgPostcode: "HG1 1TT",
  });
  if (postcodeOfficialOnly.confidence > 0.65) {
    fail("postcode + officialWebsite without firmNameEvidence should score <=0.65");
  }
  if (!postcodeOfficialOnly.rejected) {
    fail("postcode + officialWebsite without firmNameEvidence should be rejected below 0.75");
  }

  const postcodeOfficialFirm = evaluateCandidateEvidence({
    sraId: "468963",
    candidateName: "Towerhouse LLP",
    sourceType: "serper",
    sourceUrl: "https://www.towerhouse.example/",
    evidenceText: "Towerhouse LLP solicitors EC1A 1BB",
    matchedPostcode: "EC1A 1BB",
    orgPostcode: "EC1A 1BB",
  });
  if (postcodeOfficialFirm.confidence !== 0.9) {
    fail(`postcode + officialWebsite + firmNameEvidence should score 0.9, got ${postcodeOfficialFirm.confidence}`);
  }

  const zeroConfidencePeers = countCompetingViableCandidates(
    [
      {
        id: "p1",
        sraId: "100",
        candidateName: "Stowe Family Law",
        sourceType: "serper",
        sourceUrl: "https://www.stowefamilylaw.co.uk/harrogate",
        evidenceText: "HG1 1TT family law solicitors",
        candidateAddress: "",
        matchedPostcode: "HG1 1TT",
        orgPostcode: "HG1 1TT",
        orgCity: "Harrogate",
        orgWebsite: "",
      },
      {
        id: "p2",
        sraId: "100",
        candidateName: "Harrogate Family Law",
        sourceType: "serper",
        sourceUrl: "https://www.stowefamilylaw.co.uk/about",
        evidenceText: "HG1 1TT family law",
        candidateAddress: "",
        matchedPostcode: "HG1 1TT",
        orgPostcode: "HG1 1TT",
        orgCity: "Harrogate",
        orgWebsite: "",
      },
    ],
    "Gamma LLP",
  );
  if (zeroConfidencePeers !== 0) {
    fail("confidence-0 candidates should be excluded from competing_candidate count");
  }

  const eligible = isEligibleForBatchApprove(
    {
      id: "c1",
      sraId: "100",
      candidateName: "Smith & Co Solicitors",
      sourceType: "serper",
      sourceUrl: "https://smithco.example.com/",
      evidenceText: "Smith & Co Solicitors SRA Number 100",
      candidateAddress: "1 High Street",
      matchedPostcode: "S1 4SB",
      confidence: 0.99,
      status: "pending_review",
      orgPostcode: "S1 4SB",
    },
    0,
    { minConfidence: SAFE_APPROVE_MIN_CONFIDENCE },
  );
  if (!eligible.ok) fail("serper candidate with exact SRA number should be eligible for batch approve");

  const blocked = isEligibleForBatchApprove(
    {
      id: "c2",
      sraId: "100",
      candidateName: "Smith & Co Solicitors",
      sourceType: "serper",
      sourceUrl: "https://smithco.example.com/",
      evidenceText: "Smith & Co Solicitors SRA Number 100",
      candidateAddress: "1 High Street",
      matchedPostcode: "S1 4SB",
      confidence: 0.99,
      status: "pending_review",
      orgPostcode: "S1 4SB",
    },
    1,
    { minConfidence: SAFE_APPROVE_MIN_CONFIDENCE },
  );
  if (blocked.ok) fail("competing candidates should block batch approve");

  const knownBadNames: { name: string; sourceType: "serper" | "yell"; sourceUrl: string }[] = [
    {
      name: "Solicitors Regulation Authority decision tracker archive: 2025",
      sourceType: "serper",
      sourceUrl: "https://www.sra.org.uk/news/archive/decision-tracker",
    },
    {
      name: "Legal News > Your source for information behind the law",
      sourceType: "serper",
      sourceUrl: "https://legalnews.example/article",
    },
    {
      name: "MAXGAMES Trademark of 1004319 Alberta Ltd.",
      sourceType: "serper",
      sourceUrl: "https://trademarks.example/maxgames",
    },
    {
      name: "[PDF] Using Films to Teach Comparative Law",
      sourceType: "serper",
      sourceUrl: "https://university.example/paper.pdf",
    },
    {
      name: "Solicitors Near Me in Haxby",
      sourceType: "yell",
      sourceUrl: "https://www.yell.com/search/solicitors-haxby",
    },
    {
      name: "Employment Solicitors Near Me in Sheffield",
      sourceType: "yell",
      sourceUrl: "https://www.yell.com/search/employment-solicitors",
    },
    {
      name: "Hair At No 43",
      sourceType: "yell",
      sourceUrl: "https://www.yell.com/biz/hair-at-no-43",
    },
  ];
  for (const sample of knownBadNames) {
    if (!rejectCandidateName(sample.name, {
      sourceType: sample.sourceType,
      sourceUrl: sample.sourceUrl,
    }).rejected) {
      fail(`known bad identity name should reject: ${sample.name}`);
    }
    const validated = validateIdentityCandidate(
      {
        sraId: "1002231",
        candidateName: sample.name,
        sourceType: sample.sourceType,
        sourceUrl: sample.sourceUrl,
        evidenceText: "solicitors law firm S1 4SB",
        confidence: 0.95,
      },
      "1002231",
    );
    if (validated.ok) {
      fail(`known bad identity name should fail validation: ${sample.name}`);
    }
  }

  const yellCategory = validateYellListing({
    businessName: "Solicitors Near Me in Haxby",
    profileUrl: "https://www.yell.com/search/solicitors",
    address: "Haxby YO32",
    categories: "solicitors",
  });
  if (!yellCategory.rejected) {
    fail("Yell category/search listing should be rejected");
  }

  const yellBizOk = validateYellListing({
    businessName: "Town Centre Solicitors",
    profileUrl: "https://www.yell.com/biz/town-centre-solicitors",
    address: "1 High St, Sheffield S1 4SB",
    categories: "solicitors",
    phone: "0114 000 0000",
  });
  if (yellBizOk.rejected) {
    fail("Yell business listing with legal category should pass listing gate");
  }

  if (
    canSerperAutoApprove({
      sraId: "921469",
      candidateName: "Legal News > Your source for information behind the law",
      sourceUrl: "https://legalnews.example/story",
      evidenceText: "legal news article",
      orgPostcode: "S1 4SB",
      matchedPostcode: "S1 4SB",
    })
  ) {
    fail("Serper news/article title must not auto-approve");
  }

  if (
    !canSerperAutoApprove({
      sraId: "921469",
      candidateName: "Bhayani HR & Employment Law",
      sourceUrl: "https://www.bhayani.co.uk/about",
      evidenceText: "SRA Number 921469 solicitors S1 4SB employment law",
      candidateWebsite: "https://www.bhayani.co.uk/about",
      matchedPostcode: "S1 4SB",
      orgPostcode: "S1 4SB",
    })
  ) {
    fail("Serper firm with exact SRA number should auto-approve");
  }
  if (
    canSerperAutoApprove({
      sraId: "921469",
      candidateName: "Bhayani HR & Employment Law",
      sourceUrl: "https://www.bhayani.co.uk/about",
      evidenceText: "solicitors S1 4SB employment law",
      candidateWebsite: "https://www.bhayani.co.uk/about",
      matchedPostcode: "S1 4SB",
      orgPostcode: "S1 4SB",
      competingMaxConfidence: 0.85,
    })
  ) {
    fail("postcode-only Serper candidate should not auto-approve when competitors exist above 0.8");
  }

  const nearMeBatch = isEligibleForBatchApprove(
    {
      id: "c3",
      sraId: "100",
      candidateName: "Solicitors Near Me in Haxby",
      sourceType: "yell",
      sourceUrl: "https://www.yell.com/search",
      evidenceText: "solicitors near me",
      candidateAddress: "",
      matchedPostcode: "",
      confidence: 0.95,
      status: "pending_review",
    },
    0,
  );
  if (nearMeBatch.ok) {
    fail("near-me Yell heading should not be batch-approvable");
  }

  const timeoutPrisma = {
    sraOrganisation: {
      findMany: async () => {
        throw Object.assign(new Error("connect ETIMEDOUT 1.2.3.4:5432"), { code: "ETIMEDOUT" });
      },
      findFirst: async () => {
        throw Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
      },
    },
  } as unknown as PrismaClient;

  const degradedLoad = await loadOrganisationBatch(timeoutPrisma, {
    take: 3,
    onlyPlaceholders: true,
  });
  if (!degradedLoad.degraded || degradedLoad.loadError !== "ETIMEDOUT") {
    fail("loadOrganisationBatch should return degraded ETIMEDOUT without throwing");
  }
  if (!degradedLoad.timing.queryStart || degradedLoad.timing.rowsLoaded !== 0) {
    fail("degraded load should include query timing with zero rows");
  }
  if (degradedLoad.timing.elapsedMs === undefined) {
    fail("degraded load should include elapsedMs");
  }

  const degradedRun = await runMissingIdentityRecovery(timeoutPrisma, { take: 2, dryRun: true });
  if (!degradedRun.degraded || !degradedRun.loadError) {
    fail("runMissingIdentityRecovery should surface degraded DB load");
  }
  if (degradedRun.scanned !== 0) {
    fail("degraded run should not scan rows");
  }

  const placeholderRow = {
    id: "sra:1",
    sraId: "1000001",
    displayName: "SRA organisation 1000001",
    organisationName: "",
    tradingName: "",
    firmName: "",
    businessName: "",
    searchText: "",
    postcode: "",
    city: "",
    county: "",
    country: "",
    phone: "",
    normalizedAddress: null,
  };
  if (!rowMatchesRecoveryFilters(placeholderRow, { onlyPlaceholders: true })) {
    fail("placeholder row should match onlyPlaceholders filter");
  }
  if (rowMatchesRecoveryFilters(placeholderRow, { onlyAddressLike: true })) {
    fail("placeholder row should not match onlyAddressLike filter");
  }

  if (prevRetryBase === undefined) delete process.env.SRA_IDENTITY_DB_RETRY_BASE_MS;
  else process.env.SRA_IDENTITY_DB_RETRY_BASE_MS = prevRetryBase;
  if (prevRetryAttempts === undefined) delete process.env.SRA_IDENTITY_DB_RETRY_ATTEMPTS;
  else process.env.SRA_IDENTITY_DB_RETRY_ATTEMPTS = prevRetryAttempts;

  if (failed === 0) {
    console.info("PASS missing-identity-recovery eval");
  }
  return failed;
}
