import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { validateIdentityCandidate } from "@/lib/sra/missing-identity-recovery/candidate-validator";
import { shouldAutoApprove } from "@/lib/sra/missing-identity-recovery/confidence";
import { mineLocalSraCandidates } from "@/lib/sra/missing-identity-recovery/local-data-miner";
import { recoverFromSraApi } from "@/lib/sra/missing-identity-recovery/sra-api-recovery";
import { recoverFromYell } from "@/lib/sra/missing-identity-recovery/yell-recovery";
import { recoverFromSerper } from "@/lib/sra/missing-identity-recovery/serper-recovery";
import type {
  IdentitySourceType,
  MissingIdentityBatchResult,
  RecoveryCandidatePreview,
  RecoveryCandidateRejection,
  RecoveryContext,
  RecoveryLadderResult,
  SraIdentityCandidateRecord,
} from "@/lib/sra/missing-identity-recovery/types";
import { approveSraIdentityCandidate } from "@/lib/sra/missing-identity-recovery/approve-candidate";
import {
  applyCounterReasonToBatch,
  applyFailedLadderException,
  applyLadderSourceFlags,
  counterReasonFromLadder,
  type RecoveryCounterReason,
} from "@/lib/sra/missing-identity-recovery/recovery-counter";
import {
  loadOrganisationBatch,
  type SraOrgRecoveryRow,
} from "@/lib/sra/missing-identity-recovery/load-organisation-batch";
import {
  markStartupStage,
  startupTimingSummary,
  type StartupTiming,
} from "@/lib/sra/missing-identity-recovery/startup-timing";

export type MissingIdentityOptions = {
  /** Max organisations to process after DB filters (alias: take). */
  limit?: number;
  take?: number;
  dryRun?: boolean;
  resume?: boolean;
  resumeAfter?: string;
  debug?: boolean;
  sraId?: string;
  includeLawSociety?: boolean;
  onlyPlaceholders?: boolean;
  onlyAddressLike?: boolean;
  dbPageSize?: number;
  startupDebug?: boolean;
  startupTiming?: StartupTiming;
  /** Experimental: allow Yell in identity recovery ladder (default off). */
  includeYellIdentity?: boolean;
};

export function shouldRunYellIdentityRecovery(opts: {
  includeYellIdentity?: boolean;
  skipExternalSearch?: boolean;
}): boolean {
  return Boolean(opts.includeYellIdentity) && !opts.skipExternalSearch;
}

const CHECKPOINT = path.join(process.cwd(), ".cache/sra-missing-identity/checkpoint.json");

/** Law Society is manual/high-value only — not the default scalable recovery path. */
export function shouldIncludeLawSociety(opts: {
  includeLawSociety?: boolean;
  sraId?: string;
}): boolean {
  return Boolean(opts.includeLawSociety || opts.sraId?.trim());
}

function pushTop3Candidate(
  list: RecoveryCandidatePreview[],
  entry: RecoveryCandidatePreview,
): void {
  if (list.length >= 3) return;
  const key = `${entry.name.toLowerCase()}::${entry.source}`;
  if (list.some((c) => `${c.name.toLowerCase()}::${c.source}` === key)) return;
  list.push(entry);
}

function recordRejection(
  rejections: RecoveryCandidateRejection[],
  name: string,
  source: IdentitySourceType,
  reason: string,
): void {
  if (rejections.length >= 12) return;
  rejections.push({ name: name.slice(0, 120), source, reason });
}

function tallyRejection(
  result: RecoveryLadderResult,
  reason: string,
): void {
  if (reason === "address_like_name") result.rejectedAddressLike++;
  else result.rejectedWeakEvidence++;
}

async function loadCheckpoint(): Promise<{ lastSraId?: string }> {
  try {
    return JSON.parse(await readFile(CHECKPOINT, "utf8")) as { lastSraId?: string };
  } catch {
    return {};
  }
}

async function saveCheckpoint(lastSraId: string): Promise<void> {
  await mkdir(path.dirname(CHECKPOINT), { recursive: true });
  await writeFile(CHECKPOINT, JSON.stringify({ lastSraId }, null, 2), "utf8");
}

function toContext(row: SraOrgRecoveryRow): RecoveryContext {
  return {
    sraId: row.sraId,
    orgId: row.id,
    displayName: row.displayName,
    searchText: row.searchText,
    postcode: row.postcode,
    city: row.city,
    county: row.county,
    country: row.country,
    phone: row.phone,
  };
}

export async function runRecoveryLadder(
  ctx: RecoveryContext,
  opts: {
    includeLawSociety?: boolean;
    skipExternalSearch?: boolean;
    includeYellIdentity?: boolean;
  },
): Promise<RecoveryLadderResult> {
  const includeLawSociety = Boolean(opts.includeLawSociety);
  const result: RecoveryLadderResult = {
    sraId: ctx.sraId,
    candidates: [],
    queriesRun: [],
    localQueries: ["local_search_text_mining"],
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
    scalableSourcesAttempted: ["local_sra"],
    lawSocietySkipped: !includeLawSociety,
    lawSocietyBlocked: false,
    captchaBlocked: false,
    rejectedAddressLike: 0,
    rejectedWeakEvidence: 0,
    decisionReason: "unresolved",
    debugNotes: [],
  };

  const validated: SraIdentityCandidateRecord[] = [];

  const acceptCandidate = (c: SraIdentityCandidateRecord): void => {
    validated.push(c);
    pushTop3Candidate(result.top3Candidates, {
      name: c.candidateName,
      source: c.sourceType,
      confidence: c.confidence,
      status: c.status,
    });
    if (c.sourceType === "local_sra") result.localRecovered = true;
    if (c.sourceType === "sra_api") result.sraApiRecovered = true;
    if (c.sourceType === "yell") {
      result.yellRecovered = true;
      result.webFound = true;
    }
    if (c.sourceType === "serper" || c.sourceType === "google") {
      result.serperRecovered = true;
      result.webFound = true;
    }
    if (c.sourceType === "law_society") result.lawSocietyFound = true;
  };

  const tryCandidate = (
    raw: Omit<SraIdentityCandidateRecord, "status"> & { confidence: number },
  ): boolean => {
    pushTop3Candidate(result.top3Candidates, {
      name: raw.candidateName,
      source: raw.sourceType,
      confidence: raw.confidence,
    });
    const v = validateIdentityCandidate(raw, ctx.sraId);
    if (!v.ok) {
      recordRejection(result.candidateRejections, raw.candidateName, raw.sourceType, v.reason);
      tallyRejection(result, v.reason);
      return false;
    }
    acceptCandidate(v.candidate);
    return true;
  };

  const local = mineLocalSraCandidates(ctx);
  result.localCandidatesFound = local.candidates.length;
  if (local.addressLine) ctx = { ...ctx, addressLine: local.addressLine };
  for (const c of local.candidates) {
    tryCandidate(c);
  }

  if (validated.length === 0) {
    result.scalableSourcesAttempted.push("sra_api");
    const api = await recoverFromSraApi(ctx);
    result.sraApiQueries = api.queries;
    result.queriesRun.push(...api.queries);
    result.api404 = api.api404;
    if (api.api404) result.debugNotes?.push("unresolved_api_not_found");
    for (const c of api.candidates) {
      if (c.status === "rejected") {
        recordRejection(result.candidateRejections, c.candidateName, c.sourceType, c.rejectReason ?? "rejected");
        tallyRejection(result, c.rejectReason ?? "rejected");
        continue;
      }
      tryCandidate(c);
    }
  }

  if (validated.length === 0 && includeLawSociety) {
    result.scalableSourcesAttempted.push("law_society");
    result.lawSocietySkipped = false;
    try {
      const { lookupLawSocietyBySraId } = await import("@/lib/sra/law-society-sra-recovery");
      const diag = await lookupLawSocietyBySraId(ctx.sraId, {
        postcodeHint: ctx.postcode,
        displayNameHint: ctx.displayName,
      });
      const blocked = Boolean(diag.lawSocietyBlocked ?? diag.captchaBlocked);
      if (blocked) {
        result.lawSocietyBlocked = true;
        result.captchaBlocked = true;
        result.debugNotes?.push("law_society_access_blocked");
      } else if (diag.result) {
        tryCandidate({
          sraId: ctx.sraId,
          candidateName: diag.result.organisationName,
          sourceType: "law_society",
          sourceUrl: diag.result.profileUrl ?? diag.searchUrl,
          evidenceText: diag.result.evidenceText,
          candidatePhone: diag.result.phone,
          candidateAddress: diag.result.address,
          candidateWebsite: diag.result.website,
          matchedPostcode: ctx.postcode,
          matchedTown: ctx.city,
          confidence: diag.result.confidence,
        });
      }
    } catch (e) {
      result.debugNotes?.push(
        `law_society_error:${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (validated.length === 0 && !opts.skipExternalSearch) {
    if (shouldRunYellIdentityRecovery(opts)) {
      result.scalableSourcesAttempted.push("yell");
      result.yellCalled = true;
      const yell = await recoverFromYell(ctx);
      result.queriesRun.push(...yell.queries);
      result.yellQueries = yell.queries;
      result.yellCandidatesFound = yell.candidates.length;
      result.top3YellResults = yell.topResults.slice(0, 3);
      for (const hit of yell.topResults.slice(0, 3)) {
        pushTop3Candidate(result.top3Candidates, {
          name: hit.businessName,
          source: "yell",
        });
      }
      for (const c of yell.candidates) {
        tryCandidate(c);
      }
    }

    if (validated.length === 0) {
      result.scalableSourcesAttempted.push("serper");
      result.serperCalled = true;
      const serper = await recoverFromSerper(ctx, local.addressLine);
      result.queriesRun.push(...serper.queries);
      result.serperQueries = serper.queries;
      result.serperCandidatesFound = serper.candidates.length;
      result.top3SerperResults = serper.topResults.slice(0, 3);
      for (const hit of serper.topResults.slice(0, 3)) {
        pushTop3Candidate(result.top3Candidates, {
          name: hit.title,
          source: "serper",
        });
      }
      for (const c of serper.candidates) {
        tryCandidate(c);
      }
    }
  }

  result.candidates = dedupeCandidates(validated);
  if (result.candidates.length === 0) {
    if (result.api404) {
      result.decisionReason = "unresolved_api_not_found";
    } else if (result.lawSocietyBlocked) {
      result.decisionReason = "law_society_blocked_no_valid_candidates";
    } else if (result.captchaBlocked) {
      result.decisionReason = "captcha_blocked_no_other_source";
    } else if (
      (result.yellCalled || result.serperCalled) &&
      result.yellCandidatesFound === 0 &&
      result.serperCandidatesFound === 0
    ) {
      result.decisionReason = "no_search_results";
    } else {
      result.decisionReason = "no_valid_candidates";
    }
    return result;
  }

  const best = pickBestCandidate(result.candidates);
  const peers = result.candidates.filter((c) => c.candidateName !== best.candidateName);
  const competing = peers.length;
  const competingMaxConfidence = peers.reduce((max, c) => Math.max(max, c.confidence), 0);

  if (
    shouldAutoApprove(best, competing, {
      orgPostcode: ctx.postcode,
      competingMaxConfidence,
    })
  ) {
    best.status = "auto_approved";
    result.decisionReason = "auto_approved";
  } else {
    best.status = "pending_review";
    result.decisionReason = "pending_review";
  }

  result.candidates = result.candidates.map((c) =>
    c.candidateName === best.candidateName && c.sourceUrl === best.sourceUrl
      ? best
      : { ...c, status: c.status === "auto_approved" ? c.status : "pending_review" },
  );

  return result;
}

function dedupeCandidates(list: SraIdentityCandidateRecord[]): SraIdentityCandidateRecord[] {
  const by = new Map<string, SraIdentityCandidateRecord>();
  for (const c of list) {
    const key = `${c.candidateName.toLowerCase()}::${c.sourceType}`;
    const prev = by.get(key);
    if (!prev || c.confidence > prev.confidence) by.set(key, c);
  }
  return [...by.values()].sort((a, b) => b.confidence - a.confidence);
}

function pickBestCandidate(list: SraIdentityCandidateRecord[]): SraIdentityCandidateRecord {
  return [...list].sort((a, b) => b.confidence - a.confidence)[0]!;
}

export async function persistCandidates(
  prisma: PrismaClient,
  orgId: string,
  candidates: SraIdentityCandidateRecord[],
  _dryRun: boolean,
): Promise<void> {
  for (const c of candidates) {
    await prisma.sraIdentityCandidate.upsert({
      where: {
        sraId_sourceType_sourceUrl: {
          sraId: c.sraId,
          sourceType: c.sourceType,
          sourceUrl: c.sourceUrl,
        },
      },
      create: {
        sraId: c.sraId,
        organisationId: orgId,
        candidateName: c.candidateName,
        sourceType: c.sourceType,
        sourceUrl: c.sourceUrl,
        evidenceText: c.evidenceText,
        candidatePhone: c.candidatePhone ?? "",
        candidateAddress: c.candidateAddress ?? "",
        candidateWebsite: c.candidateWebsite ?? "",
        matchedPostcode: c.matchedPostcode ?? "",
        matchedTown: c.matchedTown ?? "",
        confidence: c.confidence,
        status: c.status,
        rejectReason: c.rejectReason ?? "",
      },
      update: {
        candidateName: c.candidateName,
        evidenceText: c.evidenceText,
        candidatePhone: c.candidatePhone ?? "",
        candidateAddress: c.candidateAddress ?? "",
        candidateWebsite: c.candidateWebsite ?? "",
        matchedPostcode: c.matchedPostcode ?? "",
        matchedTown: c.matchedTown ?? "",
        confidence: c.confidence,
        status: c.status,
        rejectReason: c.rejectReason ?? "",
      },
    });
  }
}

async function applyAutoApprovedCandidate(
  prisma: PrismaClient,
  orgId: string,
  candidate: SraIdentityCandidateRecord,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;

  const persisted = await prisma.sraIdentityCandidate.findFirst({
    where: {
      sraId: candidate.sraId,
      sourceType: candidate.sourceType,
      sourceUrl: candidate.sourceUrl,
    },
  });
  if (persisted) {
    await approveSraIdentityCandidate(prisma, persisted.id);
    return;
  }

  const row = await prisma.sraIdentityCandidate.create({
    data: {
      sraId: candidate.sraId,
      organisationId: orgId,
      candidateName: candidate.candidateName,
      sourceType: candidate.sourceType,
      sourceUrl: candidate.sourceUrl,
      evidenceText: candidate.evidenceText,
      candidatePhone: candidate.candidatePhone ?? "",
      candidateAddress: candidate.candidateAddress ?? "",
      candidateWebsite: candidate.candidateWebsite ?? "",
      matchedPostcode: candidate.matchedPostcode ?? "",
      matchedTown: candidate.matchedTown ?? "",
      confidence: candidate.confidence,
      status: "auto_approved",
    },
  });
  await approveSraIdentityCandidate(prisma, row.id);
}

export async function runMissingIdentityRecovery(
  prisma: PrismaClient,
  opts: MissingIdentityOptions = {},
): Promise<MissingIdentityBatchResult> {
  const take = opts.take ?? opts.limit ?? 100;
  const dryRun = opts.dryRun ?? false;
  const skipExternal = process.env.SRA_IDENTITY_SKIP_EXTERNAL_SEARCH === "1";

  const includeLawSociety = shouldIncludeLawSociety(opts);

  const batch: MissingIdentityBatchResult = {
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
    dryRun,
  };

  let resumeAfter = opts.resumeAfter?.trim();
  if (!resumeAfter && opts.resume) {
    resumeAfter = (await loadCheckpoint()).lastSraId;
  }

  const onlyPlaceholders =
    opts.onlyAddressLike === true ? false : opts.onlyPlaceholders !== false;

  markStartupStage(opts.startupTiming, "beforeBatchLoad", { take, sraId: opts.sraId ?? null });

  const loaded = await loadOrganisationBatch(prisma, {
    sraId: opts.sraId,
    take,
    resumeAfter,
    onlyPlaceholders,
    onlyAddressLike: opts.onlyAddressLike,
    dbPageSize: opts.dbPageSize,
    startupTiming: opts.startupTiming,
  });

  markStartupStage(opts.startupTiming, "afterBatchLoad", {
    rowsLoaded: loaded.rows.length,
    degraded: loaded.degraded,
    loadError: loaded.loadError ?? null,
  });

  batch.queryTiming = loaded.timing;
  const startupSummary = startupTimingSummary(opts.startupTiming);
  if (startupSummary) {
    batch.startupTiming = startupSummary;
  }

  if (opts.debug || opts.startupDebug) {
    console.info(
      JSON.stringify({
        event: "sra_missing_identity_db_load",
        ...loaded.timing,
        degraded: loaded.degraded,
        loadError: loaded.loadError,
      }),
    );
  }

  if (loaded.degraded) {
    batch.degraded = true;
    batch.loadError = loaded.loadError;
    return batch;
  }

  for (const row of loaded.rows) {
    batch.scanned++;
    const ctx = toContext(row);
    let counterReason: RecoveryCounterReason;
    let ladder: RecoveryLadderResult;

    try {
      ladder = await runRecoveryLadder(ctx, {
        includeLawSociety,
        skipExternalSearch: skipExternal,
        includeYellIdentity: opts.includeYellIdentity,
      });
    } catch (e) {
      counterReason = applyFailedLadderException(batch);
      if (opts.debug) {
        console.info(
          JSON.stringify({
            event: "sra_missing_identity_row_summary",
            sraId: ctx.sraId,
            counterReason,
            failed: true,
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }
      if (!dryRun) await saveCheckpoint(row.sraId);
      continue;
    }

    applyLadderSourceFlags(batch, ladder);
    counterReason = counterReasonFromLadder(ladder);
    applyCounterReasonToBatch(batch, counterReason, ladder);

    if (opts.debug) {
      console.info(
        JSON.stringify({
          event: "sra_missing_identity_debug",
          sraId: ctx.sraId,
          displayName: ctx.displayName,
          postcode: ctx.postcode,
          city: ctx.city,
          counterReason,
          scalableSourcesAttempted: ladder.scalableSourcesAttempted,
          lawSocietySkipped: ladder.lawSocietySkipped,
          lawSocietyBlocked: ladder.lawSocietyBlocked,
          localQueries: ladder.localQueries,
          sraApiQueries: ladder.sraApiQueries,
          api404: ladder.api404,
          yellQueries: ladder.yellQueries,
          serperQueries: ladder.serperQueries,
          yellCalled: ladder.yellCalled,
          serperCalled: ladder.serperCalled,
          localCandidatesFound: ladder.localCandidatesFound,
          yellCandidatesFound: ladder.yellCandidatesFound,
          serperCandidatesFound: ladder.serperCandidatesFound,
          top3YellResults: ladder.top3YellResults,
          top3SerperResults: ladder.top3SerperResults,
          top3Candidates: ladder.top3Candidates,
          candidateRejections: ladder.candidateRejections,
          queriesRun: ladder.queriesRun,
          candidates: ladder.candidates.map((c) => ({
            name: c.candidateName,
            source: c.sourceType,
            confidence: c.confidence,
            status: c.status,
          })),
          decisionReason: ladder.decisionReason,
          captchaBlocked: ladder.captchaBlocked,
        }),
      );
    }

    if (ladder.candidates.length === 0) {
      if (opts.debug) {
        console.info(
          JSON.stringify({
            event: "sra_missing_identity_unresolved_diagnostics",
            sraId: ctx.sraId,
            displayName: ctx.displayName,
            postcode: ctx.postcode,
            town: ctx.city,
            counterReason,
            scalableSourcesAttempted: ladder.scalableSourcesAttempted,
            lawSocietySkipped: ladder.lawSocietySkipped,
            lawSocietyBlocked: ladder.lawSocietyBlocked,
            localQueries: ladder.localQueries,
            sraApiQueries: ladder.sraApiQueries,
            api404: ladder.api404,
            serperQueries: ladder.serperQueries,
            yellQueries: ladder.yellQueries,
            localCandidatesFound: ladder.localCandidatesFound,
            serperCandidatesFound: ladder.serperCandidatesFound,
            yellCandidatesFound: ladder.yellCandidatesFound,
            serperCalled: ladder.serperCalled,
            yellCalled: ladder.yellCalled,
            top3SerperResults: ladder.top3SerperResults,
            top3YellResults: ladder.top3YellResults,
            top3Candidates: ladder.top3Candidates,
            candidateRejections: ladder.candidateRejections,
            finalDecisionReason: ladder.decisionReason,
          }),
        );
      }
      try {
        if (!dryRun) {
          await prisma.sraIdentityCandidate.upsert({
            where: {
              sraId_sourceType_sourceUrl: {
                sraId: ctx.sraId,
                sourceType: "local_sra",
                sourceUrl: `unresolved:${ctx.sraId}`,
              },
            },
            create: {
              sraId: ctx.sraId,
              organisationId: ctx.orgId,
              candidateName: "",
              sourceType: "local_sra",
              sourceUrl: `unresolved:${ctx.sraId}`,
              evidenceText: ladder.decisionReason,
              status: "unresolved",
              confidence: 0,
            },
            update: { status: "unresolved", evidenceText: ladder.decisionReason },
          });
        }
      } catch (persistErr) {
        if (opts.debug) {
          console.info(
            JSON.stringify({
              event: "sra_missing_identity_row_summary",
              sraId: ctx.sraId,
              counterReason,
              persistError: persistErr instanceof Error ? persistErr.message : String(persistErr),
            }),
          );
        }
      }
      if (!dryRun) await saveCheckpoint(row.sraId);
      continue;
    }

    const best = pickBestCandidate(ladder.candidates);
    try {
      await persistCandidates(prisma, ctx.orgId, ladder.candidates, dryRun);
      if (best.status === "auto_approved") {
        await applyAutoApprovedCandidate(prisma, ctx.orgId, best, dryRun);
      }
    } catch (persistErr) {
      if (opts.debug) {
        console.info(
          JSON.stringify({
            event: "sra_missing_identity_row_summary",
            sraId: ctx.sraId,
            counterReason,
            persistError: persistErr instanceof Error ? persistErr.message : String(persistErr),
          }),
        );
      }
    }

    if (!dryRun) await saveCheckpoint(row.sraId);
  }

  return batch;
}
