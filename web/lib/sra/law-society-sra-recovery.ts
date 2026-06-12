import {
  parseLawSocietyProfileHtml,
  parseLawSocietySearchResultsHtml,
  postcodesMatch,
  type ParsedLawSocietyResultRow,
} from "@/lib/sra/law-society-parse";
import {
  buildLawSocietyResultsUrl,
  closeLawSocietyBrowser,
  extractResultsFromPage,
  isLawSocietyAccessBlocked,
  printLawSocietyDebug,
  runLawSocietyFormSearch,
  saveLawSocietyDebugArtifacts,
  withLawSocietyPage,
} from "@/lib/sra/law-society-playwright";
import { isUsableFirmNameCandidate } from "@/lib/sra/sra-name-quality";
import { isPlaceholderSraDisplayName } from "@/lib/sra/sra-name-quality";

export type LawSocietyRecoveryResult = {
  sraId: string;
  organisationName: string;
  website?: string;
  phone?: string;
  address?: string;
  profileUrl?: string;
  practiceAreas?: string[];
  solicitors?: string[];
  lawSocietyId?: string;
  evidenceText: string;
  confidence: number;
  matchKind:
    | "exact_sra_profile"
    | "single_postcode"
    | "probable"
    | "multiple"
    | "not_found";
};

export type LawSocietyRecoveryDiagnostics = {
  sraId: string;
  searchUrl: string;
  resultCount: number;
  rows: ParsedLawSocietyResultRow[];
  result: LawSocietyRecoveryResult | null;
  captchaBlocked?: boolean;
  lawSocietyBlocked?: boolean;
  attempts?: string[];
  challengeDetected?: boolean;
  challengeResolved?: boolean;
  challengeTimedOut?: boolean;
  navigationsObserved?: number;
  finalUrl?: string;
};

/** @deprecated Use buildLawSocietyResultsUrl — kept for eval compatibility */
export function lawSocietySearchUrlForSraId(sraId: string): string {
  return buildLawSocietyResultsUrl({ nameOrSraId: sraId });
}

export { closeLawSocietyBrowser };

function mergeRows(
  domRows: ParsedLawSocietyResultRow[],
  html: string,
  targetSraId: string,
): ParsedLawSocietyResultRow[] {
  const parsed = parseLawSocietySearchResultsHtml(html, targetSraId);
  const byUrl = new Map<string, ParsedLawSocietyResultRow>();
  for (const r of [...domRows, ...parsed]) {
    if (!r.profileUrl) continue;
    const existing = byUrl.get(r.profileUrl);
    byUrl.set(r.profileUrl, existing ? { ...existing, ...r, organisationName: r.organisationName || existing.organisationName } : r);
  }
  return filterLawSocietyRows([...byUrl.values()], targetSraId);
}

/** Drop solicitor-count links and other non-firm rows. */
export function filterLawSocietyRows(
  rows: ParsedLawSocietyResultRow[],
  targetSraId: string,
): ParsedLawSocietyResultRow[] {
  const filtered = rows.filter((r) => {
    const name = r.organisationName?.trim() ?? "";
    if (!name || name.length < 3) return false;
    if (/^\d+\s+solicitors?$/i.test(name)) return false;
    if (/^\d+\s+office$/i.test(name)) return false;
    if (!/\/organisation\/|\/office\//i.test(r.profileUrl)) return false;
    if (r.profileUrl.includes("/organisation/people/")) return false;
    return isUsableFirmNameCandidate(name, targetSraId);
  });

  const byOffice = new Map<string, ParsedLawSocietyResultRow>();
  for (const r of filtered) {
    const officeKey =
      r.profileUrl.match(/\/(?:office|organisation)\/(\d+)/i)?.[1] ?? r.profileUrl;
    const prev = byOffice.get(officeKey);
    if (
      !prev ||
      (r.organisationName?.length ?? 0) > (prev.organisationName?.length ?? 0) ||
      Boolean(r.sraIdOnPage && !prev.sraIdOnPage)
    ) {
      byOffice.set(officeKey, r);
    }
  }
  return [...byOffice.values()];
}

export function scoreLawSocietyMatch(args: {
  targetSraId: string;
  rows: ParsedLawSocietyResultRow[];
  postcodeHint?: string;
  profileRow?: Partial<ParsedLawSocietyResultRow>;
}): LawSocietyRecoveryResult | null {
  const { targetSraId, rows, postcodeHint } = args;

  if (rows.length === 0) return null;

  const exactBySra = rows.filter((r) => r.sraIdOnPage === targetSraId);

  const pick = (row: ParsedLawSocietyResultRow, profile?: Partial<ParsedLawSocietyResultRow>) => {
    const organisationName = profile?.organisationName || row.organisationName;
    if (!isUsableFirmNameCandidate(organisationName, targetSraId)) return null;

    const merged = { ...row, ...profile };
    const evidenceText = [
      `sraId=${targetSraId}`,
      `name=${organisationName}`,
      merged.address && `address=${merged.address}`,
      merged.sraIdOnPage && `sraOnPage=${merged.sraIdOnPage}`,
      merged.profileUrl,
    ]
      .filter(Boolean)
      .join("; ");

    return {
      sraId: targetSraId,
      organisationName,
      website: merged.website,
      phone: merged.phone,
      address: merged.address,
      profileUrl: merged.profileUrl,
      practiceAreas: merged.practiceAreas,
      solicitors: merged.solicitors,
      lawSocietyId: merged.lawSocietyId,
      evidenceText,
    };
  };

  if (exactBySra.length === 1) {
    const base = pick(exactBySra[0]!, args.profileRow);
    if (!base) return null;
    return { ...base, confidence: 0.99, matchKind: "exact_sra_profile" };
  }

  if (exactBySra.length > 1) {
    return {
      sraId: targetSraId,
      organisationName: exactBySra[0]!.organisationName,
      profileUrl: exactBySra[0]!.profileUrl,
      evidenceText: `multiple exact (${exactBySra.length})`,
      confidence: 0.8,
      matchKind: "multiple",
    };
  }

  if (rows.length === 1) {
    const row = rows[0]!;
    if (postcodeHint && postcodesMatch(row.address, postcodeHint)) {
      const base = pick(row, args.profileRow);
      if (!base) return null;
      return { ...base, confidence: 0.95, matchKind: "single_postcode" };
    }
    const base = pick(row, args.profileRow);
    if (!base) return null;
    return {
      ...base,
      confidence: row.sraIdOnPage === targetSraId ? 0.99 : 0.9,
      matchKind: row.sraIdOnPage === targetSraId ? "exact_sra_profile" : "probable",
    };
  }

  if (postcodeHint) {
    const pcRows = rows.filter((r) => postcodesMatch(r.address, postcodeHint));
    if (pcRows.length === 1) {
      const base = pick(pcRows[0]!, args.profileRow);
      if (!base) return null;
      return { ...base, confidence: 0.95, matchKind: "single_postcode" };
    }
  }

  if (rows.length > 1) {
    return {
      sraId: targetSraId,
      organisationName: rows[0]!.organisationName,
      profileUrl: rows[0]!.profileUrl,
      evidenceText: `multiple results (${rows.length})`,
      confidence: 0.8,
      matchKind: "multiple",
    };
  }

  return null;
}

async function fetchProfileHtml(profileUrl: string): Promise<string | null> {
  const { withLawSocietyPage } = await import("@/lib/sra/law-society-playwright");
  return withLawSocietyPage(async (page) => {
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    return page.content();
  });
}

async function executeSearchStrategies(
  sraId: string,
  opts: {
    postcodeHint?: string;
    displayNameHint?: string;
    debug?: boolean;
  },
): Promise<{
  rows: ParsedLawSocietyResultRow[];
  searchUrl: string;
  captchaBlocked: boolean;
  attempts: string[];
  lastHtml: string;
  challengeDetected: boolean;
  challengeResolved: boolean;
  challengeTimedOut: boolean;
  navigationsObserved: number;
  finalUrl: string;
}> {
  const attempts: string[] = [];
  let captchaBlocked = false;
  let lastHtml = "";
  let searchUrl = buildLawSocietyResultsUrl({ nameOrSraId: sraId });
  let allRows: ParsedLawSocietyResultRow[] = [];
  let challengeDetected = false;
  let challengeResolved = false;
  let challengeTimedOut = false;
  let navigationsObserved = 0;
  let finalUrl = searchUrl;

  const strategies: {
    strategy: "sra_id" | "postcode" | "display_name";
    query: string;
    location?: string;
  }[] = [{ strategy: "sra_id", query: sraId }];

  if (opts.postcodeHint?.trim()) {
    strategies.push({
      strategy: "postcode",
      query: sraId,
      location: opts.postcodeHint.trim(),
    });
  }

  const name = opts.displayNameHint?.trim();
  if (
    name &&
    !isPlaceholderSraDisplayName(name, sraId) &&
    isUsableFirmNameCandidate(name, sraId)
  ) {
    strategies.push({ strategy: "display_name", query: name });
  }

  await withLawSocietyPage(async (page) => {
    for (const s of strategies) {
      attempts.push(
        s.location
          ? `${s.strategy}:${s.query}+loc=${s.location}`
          : `${s.strategy}:${s.query}`,
      );

      let attempt;
      try {
        attempt = await runLawSocietyFormSearch(page, {
          nameOrSraId: s.query,
          location: s.location,
          strategy: s.strategy,
        });
      } catch (e) {
        if (opts.debug) {
          const dbg = await saveLawSocietyDebugArtifacts(page, sraId);
          printLawSocietyDebug(dbg);
          console.error(
            JSON.stringify({
              event: "law_society_search_error",
              strategy: s.strategy,
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        }
        continue;
      }

      searchUrl = attempt.finalUrl.includes("/search/results")
        ? attempt.finalUrl
        : buildLawSocietyResultsUrl({
            nameOrSraId: s.query,
            location: s.location,
          });

      lastHtml = attempt.html;
      finalUrl = attempt.finalUrl;
      challengeDetected = challengeDetected || attempt.challengeDetected;
      challengeResolved = challengeResolved || attempt.challengeResolved;
      challengeTimedOut = challengeTimedOut || attempt.challengeTimedOut;
      navigationsObserved += attempt.navigationsObserved;

      const dom = await extractResultsFromPage(page);
      const rows = mergeRows(dom.rows, attempt.html, sraId);
      if (rows.length > 0) captchaBlocked = false;
      else captchaBlocked = captchaBlocked || attempt.captchaBlocked;
      if (rows.length > 0) {
        allRows = rows;
        if (opts.debug) {
          const dbg = await saveLawSocietyDebugArtifacts(page, sraId);
          printLawSocietyDebug(dbg);
          console.info(
            `visibleResults: ${rows.length} strategy=${s.strategy} headings:`,
            dom.headings.slice(0, 5),
          );
        }
        break;
      }

      if (opts.debug) {
        console.info(
          JSON.stringify({
            event: "law_society_search_attempt",
            strategy: s.strategy,
            finalUrl: attempt.finalUrl,
            httpStatus: attempt.httpStatus,
            captchaBlocked: attempt.captchaBlocked,
            resultCountText: attempt.resultCountText,
            resultCount: attempt.resultCount,
            headings: attempt.headings.slice(0, 5),
            challengeDetected: attempt.challengeDetected,
            challengeResolved: attempt.challengeResolved,
            challengeTimedOut: attempt.challengeTimedOut,
            navigationsObserved: attempt.navigationsObserved,
          }),
        );
      }
    }

    if (opts.debug && allRows.length === 0) {
      const dbg = await saveLawSocietyDebugArtifacts(page, sraId);
      printLawSocietyDebug(dbg);
    }
  });

  return {
    rows: allRows,
    searchUrl,
    captchaBlocked,
    attempts,
    lastHtml,
    challengeDetected,
    challengeResolved,
    challengeTimedOut,
    navigationsObserved,
    finalUrl,
  };
}

export async function lookupLawSocietyBySraId(
  sraId: string,
  opts: {
    postcodeHint?: string;
    displayNameHint?: string;
    searchHtmlOverride?: string;
    profileHtmlOverride?: string;
    skipProfileFetch?: boolean;
    debug?: boolean;
  } = {},
): Promise<LawSocietyRecoveryDiagnostics> {
  const id = sraId.trim().replace(/^sra:/i, "");

  let rows: ParsedLawSocietyResultRow[] = [];
  let searchUrl = buildLawSocietyResultsUrl({ nameOrSraId: id });
  let captchaBlocked = false;
  let attempts: string[] = [];
  let lastHtml = opts.searchHtmlOverride ?? "";
  let challengeDetected = false;
  let challengeResolved = false;
  let challengeTimedOut = false;
  let navigationsObserved = 0;
  let finalUrl = searchUrl;

  if (opts.searchHtmlOverride) {
    rows = parseLawSocietySearchResultsHtml(opts.searchHtmlOverride, id);
  } else {
    const run = await executeSearchStrategies(id, {
      postcodeHint: opts.postcodeHint,
      displayNameHint: opts.displayNameHint,
      debug: opts.debug,
    });
    rows = run.rows;
    searchUrl = run.searchUrl;
    captchaBlocked = run.captchaBlocked;
    attempts = run.attempts;
    lastHtml = run.lastHtml;
    challengeDetected = run.challengeDetected;
    challengeResolved = run.challengeResolved;
    challengeTimedOut = run.challengeTimedOut;
    navigationsObserved = run.navigationsObserved;
    finalUrl = run.finalUrl;
    if (opts.debug) {
      console.info(
        JSON.stringify({
          event: "law_society_challenge_outcome",
          challengeDetected,
          challengeResolved,
          challengeTimedOut,
          navigationsObserved,
          finalUrl,
          resultCount: rows.length,
        }),
      );
    }
  }

  let profileRow: Partial<ParsedLawSocietyResultRow> | undefined;
  if (!opts.skipProfileFetch && rows[0]?.profileUrl && !opts.profileHtmlOverride) {
    try {
      const profileHtml = await fetchProfileHtml(rows[0].profileUrl);
      if (profileHtml) {
        profileRow = parseLawSocietyProfileHtml(profileHtml);
        if (profileRow.sraIdOnPage && profileRow.sraIdOnPage !== id) {
          profileRow = undefined;
        }
      }
    } catch {
      /* optional */
    }
  } else if (opts.profileHtmlOverride) {
    profileRow = parseLawSocietyProfileHtml(opts.profileHtmlOverride);
  }

  const scored = scoreLawSocietyMatch({
    targetSraId: id,
    rows,
    postcodeHint: opts.postcodeHint,
    profileRow,
  });

  if (
    scored &&
    opts.displayNameHint &&
    isUsableFirmNameCandidate(opts.displayNameHint, id) &&
    !isPlaceholderSraDisplayName(opts.displayNameHint, id) &&
    rows.length >= 1
  ) {
    const hint = opts.displayNameHint.trim();
    scored.organisationName = hint;
    scored.evidenceText = `${scored.evidenceText}; tradingAs=${hint}`;
  }

  const result =
    scored && scored.matchKind !== "multiple"
      ? scored
      : scored?.matchKind === "multiple"
        ? null
        : scored;

  const accessBlocked =
    captchaBlocked || isLawSocietyAccessBlocked(lastHtml, finalUrl);

  return {
    sraId: id,
    searchUrl,
    resultCount: rows.length,
    rows,
    result,
    captchaBlocked: accessBlocked && rows.length === 0,
    lawSocietyBlocked: accessBlocked && rows.length === 0,
    attempts,
    challengeDetected,
    challengeResolved,
    challengeTimedOut,
    navigationsObserved,
    finalUrl,
  };
}

export function lawSocietyResultToRegisterLookup(
  r: LawSocietyRecoveryResult,
): {
  sraId: string;
  displayName: string;
  organisationName: string;
  firmName: string;
  address?: string;
  website?: string;
  phone?: string;
  sourceUrl: string;
  fetchedAt: string;
  confidence: number;
  source: "law_society_sra_lookup";
} {
  return {
    sraId: r.sraId,
    displayName: r.organisationName,
    organisationName: r.organisationName,
    firmName: r.organisationName,
    address: r.address,
    website: r.website,
    phone: r.phone,
    sourceUrl: r.profileUrl ?? buildLawSocietyResultsUrl({ nameOrSraId: r.sraId }),
    fetchedAt: new Date().toISOString(),
    confidence: r.confidence,
    source: "law_society_sra_lookup",
  };
}
