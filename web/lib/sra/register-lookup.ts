import {
  extractSraRawNameFields,
  normaliseSraOrganisation,
  sraProfileUrlForId,
  type SraMeiliDocument,
} from "@/lib/search/sra-document";
import { pickSraIndexTitle } from "@/lib/search/sra-name-fields";
import {
  extractFirmNameFromSraSearchText,
} from "@/lib/search/sra-display";
import { isAddressLikeName, isUsableFirmNameCandidate } from "@/lib/sra/sra-name-quality";
import { isPlaceholderSraDisplayName } from "@/lib/sra/sra-name-quality";

export type SraRegisterLookupResult = {
  sraId: string;
  organisationName?: string;
  tradingName?: string;
  firmName?: string;
  displayName?: string;
  address?: string;
  website?: string;
  phone?: string;
  sourceUrl: string;
  fetchedAt: string;
  confidence: number;
  source: "sra_register" | "sra_api" | "law_society_sra_lookup";
  rejectReason?: "address_like_name" | "not_found" | "placeholder_only";
};

export type SraLookupAttemptTrace = {
  channel: "sra_api" | "sra_register_page" | "postgres_sync" | "law_society";
  url: string;
  httpStatus?: number;
  contentType?: string;
  bodyPreview?: string;
  parseNote?: string;
  parsedFields?: Record<string, string | undefined>;
  outcome: "success" | "http_error" | "parse_miss" | "rejected" | "skipped" | "exception";
  rejectReason?: string;
  error?: string;
};

export type SraRegisterLookupDiagnostics = {
  sraId: string;
  attempts: SraLookupAttemptTrace[];
  result: SraRegisterLookupResult | null;
  finalOutcome: "found" | "not_found" | "address_like_name" | "invalid_id" | "api_key_missing";
};

const DATASHARE_BASE =
  process.env.SRA_DATASHARE_BASE_URL?.trim() ||
  "https://sra-prod-apim.azure-api.net/datashare/api/V1";

const BODY_PREVIEW_LEN = 500;

const GENERIC_SRA_PAGE_TITLES = [
  /^check a solicitor/i,
  /^find a solicitor/i,
  /^solicitor check/i,
  /^search results/i,
  /^sra\s+organisation/i,
  /^organisation\s+\d+$/i,
];

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function isGenericSraPageTitle(name: string): boolean {
  const n = decodeHtmlEntities(name).trim();
  return GENERIC_SRA_PAGE_TITLES.some((re) => re.test(n));
}

async function lookupFromSyncedPostgres(
  sraId: string,
  attempts: SraLookupAttemptTrace[],
): Promise<SraRegisterLookupResult | null> {
  if (!process.env.DATABASE_URL?.trim()) return null;

  try {
    const { prisma } = await import("@/lib/db/prisma");
    const row = await prisma.sraOrganisation.findFirst({
      where: { sraId },
      select: {
        sraId: true,
        displayName: true,
        organisationName: true,
        tradingName: true,
        firmName: true,
        businessName: true,
        searchText: true,
        city: true,
        postcode: true,
        phone: true,
        sraProfileUrl: true,
      },
    });

    const trace: SraLookupAttemptTrace = {
      channel: "postgres_sync",
      url: `postgres:sra_organisations?sraId=${sraId}`,
      outcome: "parse_miss",
      parseNote: "local_datashare_row",
    };
    attempts.push(trace);

    if (!row) {
      trace.parseNote = "no_local_row";
      return null;
    }

    trace.parsedFields = {
      displayName: row.displayName,
      organisationName: row.organisationName,
      tradingName: row.tradingName,
      firmName: row.firmName,
      businessName: row.businessName,
      searchTextPreview: row.searchText.slice(0, 200),
    };

    const fromSearch = extractFirmNameFromSraSearchText(row.searchText, sraId);
    const displayName = pickSraIndexTitle(sraId, row.searchText, {
      displayName: row.displayName,
      tradingName: row.tradingName,
      organisationName: row.organisationName,
      firmName: row.firmName,
      businessName: row.businessName,
    });

    if (
      isPlaceholderSraDisplayName(displayName, sraId) &&
      !fromSearch
    ) {
      trace.parseNote = "local_row_still_placeholder";
      return null;
    }

    const finalName = fromSearch && isUsableFirmNameCandidate(fromSearch, sraId)
      ? fromSearch
      : displayName;

    if (!isUsableFirmNameCandidate(finalName, sraId)) {
      if (isAddressLikeName(finalName)) {
        trace.outcome = "rejected";
        trace.rejectReason = "address_like_name";
        return {
          sraId,
          sourceUrl: row.sraProfileUrl || sraProfileUrlForId(sraId),
          fetchedAt: new Date().toISOString(),
          confidence: 0,
          source: "sra_api",
          rejectReason: "address_like_name",
        };
      }
      trace.parseNote = "local_name_not_usable";
      return null;
    }

    trace.outcome = "success";
    trace.parseNote = fromSearch ? "search_text_firm_line" : "display_name_column";

    return {
      sraId,
      displayName: finalName,
      organisationName: row.organisationName || finalName,
      tradingName: row.tradingName || undefined,
      firmName: row.firmName || undefined,
      address: [row.city, row.postcode].filter(Boolean).join(", ") || undefined,
      phone: row.phone || undefined,
      sourceUrl: row.sraProfileUrl || sraProfileUrlForId(sraId),
      fetchedAt: new Date().toISOString(),
      confidence: 0.95,
      source: "sra_api",
    };
  } catch (e) {
    attempts.push({
      channel: "postgres_sync",
      url: `postgres:sra_organisations?sraId=${sraId}`,
      outcome: "exception",
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

let lastFetchAt = 0;
const MIN_INTERVAL_MS = Number(process.env.SRA_REGISTER_LOOKUP_INTERVAL_MS ?? "600");

function bodyPreview(text: string): string {
  return text.slice(0, BODY_PREVIEW_LEN);
}

async function rateLimit(): Promise<void> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastFetchAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
}

function apiHeaders(): Record<string, string> | null {
  const key = process.env.SRA_APIM_SUBSCRIPTION_KEY?.trim();
  if (!key) return null;
  return {
    "Cache-Control": "no-cache",
    "Ocp-Apim-Subscription-Key": key,
  };
}

export function apiUrlsForOrganisationId(sraId: string): string[] {
  const id = encodeURIComponent(sraId.trim());
  return [
    `${DATASHARE_BASE}/organisation/Get?OrganisationId=${id}`,
    `${DATASHARE_BASE}/organisation/Get?organisationId=${id}`,
    `${DATASHARE_BASE}/organisation/Get?id=${id}`,
    `${DATASHARE_BASE}/organisation/Get/${id}`,
    `${DATASHARE_BASE}/organisation/GetById/${id}`,
  ];
}

function unwrapApiBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  if (Array.isArray(body)) {
    const first = body[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
  }
  const o = body as Record<string, unknown>;
  for (const k of ["value", "data", "organisation", "Organisation", "result", "Result"]) {
    const v = o[k];
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  }
  return o;
}

function docToLookup(
  doc: SraMeiliDocument,
  sourceUrl: string,
  source: "sra_register" | "sra_api",
  confidence: number,
): SraRegisterLookupResult {
  const address = [doc.city, doc.postcode, doc.county, doc.country].filter(Boolean).join(", ");
  const websiteMatch = doc.searchText.match(/https?:\/\/[^\s,)]+/i);

  return {
    sraId: doc.sraId,
    organisationName: doc.organisationName || undefined,
    tradingName: doc.tradingName || undefined,
    firmName: doc.firmName || undefined,
    displayName: doc.displayName || doc.businessName,
    address: address || undefined,
    website: websiteMatch?.[0],
    phone: doc.phone || undefined,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    confidence,
    source,
  };
}

function parsedFieldsFromDoc(doc: SraMeiliDocument): Record<string, string | undefined> {
  return {
    displayName: doc.displayName,
    organisationName: doc.organisationName,
    tradingName: doc.tradingName,
    firmName: doc.firmName,
    businessName: doc.businessName,
    sraId: doc.sraId,
    city: doc.city,
    postcode: doc.postcode,
  };
}

function pickBestNameFromDoc(doc: SraMeiliDocument, sraId: string): {
  displayName: string;
  organisationName: string;
  tradingName: string;
  firmName: string;
  rejectReason?: SraRegisterLookupResult["rejectReason"];
} | null {
  const displayName = pickSraIndexTitle(sraId, doc.searchText, {
    displayName: doc.displayName,
    tradingName: doc.tradingName,
    organisationName: doc.organisationName,
    firmName: doc.firmName,
    businessName: doc.businessName,
  });

  const candidates = [
    displayName,
    doc.organisationName,
    doc.tradingName,
    doc.firmName,
    doc.businessName,
  ].filter(Boolean);

  for (const c of candidates) {
    if (isAddressLikeName(c)) {
      return {
        displayName: "",
        organisationName: "",
        tradingName: "",
        firmName: "",
        rejectReason: "address_like_name",
      };
    }
  }

  if (!isUsableFirmNameCandidate(displayName, sraId)) {
    return null;
  }

  return {
    displayName,
    organisationName: doc.organisationName || displayName,
    tradingName: doc.tradingName || "",
    firmName: doc.firmName || "",
  };
}

async function fetchFromSraApi(
  sraId: string,
  attempts: SraLookupAttemptTrace[],
): Promise<SraRegisterLookupResult | null> {
  if (process.env.SRA_REGISTER_LOOKUP_SKIP_API === "1") {
    attempts.push({
      channel: "sra_api",
      url: "(skipped)",
      outcome: "skipped",
      parseNote: "SRA_REGISTER_LOOKUP_SKIP_API=1",
    });
    return null;
  }

  const headers = apiHeaders();
  if (!headers) {
    attempts.push({
      channel: "sra_api",
      url: DATASHARE_BASE,
      outcome: "exception",
      error: "SRA_APIM_SUBSCRIPTION_KEY not set",
    });
    return null;
  }

  for (const url of apiUrlsForOrganisationId(sraId)) {
    const trace: SraLookupAttemptTrace = {
      channel: "sra_api",
      url,
      outcome: "parse_miss",
    };
    attempts.push(trace);

    await rateLimit();
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(20_000),
      });
      trace.httpStatus = res.status;
      trace.contentType = res.headers.get("content-type") ?? undefined;

      const rawText = await res.text();
      trace.bodyPreview = bodyPreview(rawText);

      if (res.status === 404) {
        trace.outcome = "http_error";
        trace.parseNote = "http_404";
        continue;
      }
      if (res.status === 429 || res.status === 503) {
        trace.outcome = "http_error";
        trace.parseNote = `http_${res.status}_retry`;
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (!res.ok) {
        trace.outcome = "http_error";
        trace.parseNote = `http_${res.status}`;
        continue;
      }

      let body: unknown;
      try {
        body = JSON.parse(rawText) as unknown;
      } catch {
        trace.outcome = "parse_miss";
        trace.parseNote = "response_not_json";
        continue;
      }

      const raw = unwrapApiBody(body);
      if (!raw) {
        trace.parseNote = "unwrap_api_body_failed";
        continue;
      }

      const doc = normaliseSraOrganisation(raw);
      if (!doc) {
        trace.parseNote = "normalise_sra_organisation_failed";
        trace.parsedFields = { rawKeys: Object.keys(raw).slice(0, 12).join(",") };
        continue;
      }

      trace.parsedFields = parsedFieldsFromDoc(doc);

      if (doc.sraId !== sraId.trim()) {
        trace.parseNote = `sra_id_mismatch: got ${doc.sraId}`;
        continue;
      }

      const names = pickBestNameFromDoc(doc, sraId);
      if (!names) {
        trace.parseNote = "no_usable_firm_name_in_api_payload";
        continue;
      }
      if (names.rejectReason === "address_like_name") {
        trace.outcome = "rejected";
        trace.rejectReason = "address_like_name";
        return {
          sraId,
          sourceUrl: url,
          fetchedAt: new Date().toISOString(),
          confidence: 0,
          source: "sra_api",
          rejectReason: "address_like_name",
        };
      }

      trace.outcome = "success";
      trace.parseNote = "api_match";

      const out = docToLookup(doc, url, "sra_api", 0.92);
      out.displayName = names.displayName;
      out.organisationName = names.organisationName;
      out.tradingName = names.tradingName || undefined;
      out.firmName = names.firmName || undefined;
      return out;
    } catch (e) {
      trace.outcome = "exception";
      trace.error = e instanceof Error ? e.message : String(e);
    }
  }

  return null;
}

function parseNamesFromRegisterHtml(html: string, sraId: string): {
  names: ReturnType<typeof extractSraRawNameFields>;
  website?: string;
  phone?: string;
  address?: string;
  parseNote?: string;
} | null {
  const jsonLdRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = jsonLdRe.exec(html))) {
    try {
      const data = JSON.parse(m[1]!) as Record<string, unknown>;
      const name = String(data.name ?? data.legalName ?? "").trim();
      if (name && isUsableFirmNameCandidate(name, sraId)) {
        return {
          names: {
            organisationName: name,
            tradingName: "",
            firmName: "",
            name,
            authorisationName: "",
            recognisedBodyName: "",
          },
          website: typeof data.url === "string" ? data.url : undefined,
          parseNote: "json_ld_name",
        };
      }
    } catch {
      /* next */
    }
  }

  const orgNameRe =
    /"(?:organisationName|OrganisationName|practiceName|PracticeName|authorisedName|AuthorisedName)"\s*:\s*"([^"]+)"/gi;
  while ((m = orgNameRe.exec(html))) {
    const name = m[1]!.replace(/\\u0026/g, "&").trim();
    if (isUsableFirmNameCandidate(name, sraId)) {
      return {
        names: {
          organisationName: name,
          tradingName: "",
          firmName: "",
          name,
          authorisationName: "",
          recognisedBodyName: "",
        },
        parseNote: "embedded_json_name",
      };
    }
    if (isAddressLikeName(name)) {
      return {
        names: extractSraRawNameFields({}, []),
        parseNote: "embedded_json_address_like",
      };
    }
  }

  const h1Re = /<h1[^>]*>([^<]{3,200})<\/h1>/i;
  const h1 = html.match(h1Re);
  if (h1?.[1]) {
    const name = decodeHtmlEntities(h1[1].replace(/\s+/g, " ").trim());
    if (isGenericSraPageTitle(name)) {
      return null;
    }
    if (isUsableFirmNameCandidate(name, sraId)) {
      return {
        names: {
          organisationName: name,
          tradingName: "",
          firmName: "",
          name,
          authorisationName: "",
          recognisedBodyName: "",
        },
        parseNote: "h1_title",
      };
    }
  }

  return null;
}

async function fetchFromSraRegisterPage(
  sraId: string,
  attempts: SraLookupAttemptTrace[],
): Promise<SraRegisterLookupResult | null> {
  const sourceUrl = sraProfileUrlForId(sraId);
  const trace: SraLookupAttemptTrace = {
    channel: "sra_register_page",
    url: sourceUrl,
    outcome: "parse_miss",
  };
  attempts.push(trace);

  await rateLimit();

  if (process.env.PROVIDER_ENRICHMENT_SKIP_FETCH === "1") {
    trace.outcome = "skipped";
    trace.parseNote = "PROVIDER_ENRICHMENT_SKIP_FETCH=1";
    return null;
  }

  try {
    const res = await fetch(sourceUrl, {
      headers: { "User-Agent": "LegalShaman-Enrichment/1.0 (+signposting)" },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    trace.httpStatus = res.status;
    trace.contentType = res.headers.get("content-type") ?? undefined;
    const html = await res.text();
    trace.bodyPreview = bodyPreview(html);

    if (!res.ok) {
      trace.outcome = "http_error";
      trace.parseNote = `http_${res.status}`;
      return null;
    }

    const parsed = parseNamesFromRegisterHtml(html, sraId);
    if (!parsed) {
      trace.parseNote = trace.parseNote ?? "html_parse_no_firm_name";
      return null;
    }

    trace.parseNote = parsed.parseNote ?? "html_parsed";

    const pageText = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ");

    const displayName = decodeHtmlEntities(
      pickSraIndexTitle(sraId, pageText, {
        organisationName: parsed.names.organisationName,
        tradingName: parsed.names.tradingName,
        firmName: parsed.names.firmName,
        name: parsed.names.name,
        authorisationName: parsed.names.authorisationName,
        recognisedBodyName: parsed.names.recognisedBodyName,
      }),
    );

    trace.parsedFields = {
      displayName,
      organisationName: parsed.names.organisationName,
      tradingName: parsed.names.tradingName,
      firmName: parsed.names.firmName,
      name: parsed.names.name,
    };

    if (!isUsableFirmNameCandidate(displayName, sraId)) {
      if (isAddressLikeName(displayName)) {
        trace.outcome = "rejected";
        trace.rejectReason = "address_like_name";
        return {
          sraId,
          sourceUrl,
          fetchedAt: new Date().toISOString(),
          confidence: 0,
          source: "sra_register",
          rejectReason: "address_like_name",
        };
      }
      trace.parseNote = "display_name_not_usable";
      return null;
    }

    const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
    const phoneMatch = text.match(/\+44[\d\s]{9,15}|0\d{2,4}[\s\d]{7,12}/);
    const websiteMatch = text.match(/https?:\/\/[^\s"'<>]+/i);

    trace.outcome = "success";

    return {
      sraId,
      organisationName: parsed.names.organisationName || displayName,
      tradingName: parsed.names.tradingName || undefined,
      firmName: parsed.names.firmName || undefined,
      displayName,
      address: parsed.address,
      website: parsed.website ?? websiteMatch?.[0],
      phone: parsed.phone ?? phoneMatch?.[0],
      sourceUrl,
      fetchedAt: new Date().toISOString(),
      confidence: 0.84,
      source: "sra_register",
    };
  } catch (e) {
    trace.outcome = "exception";
    trace.error = e instanceof Error ? e.message : String(e);
    return null;
  }
}

async function lookupFromLawSociety(
  sraId: string,
  attempts: SraLookupAttemptTrace[],
  hints?: { postcodeHint?: string; displayNameHint?: string },
): Promise<SraRegisterLookupResult | null> {
  const { buildLawSocietyResultsUrl } = await import("@/lib/sra/law-society-playwright");
  const trace: SraLookupAttemptTrace = {
    channel: "law_society",
    url: buildLawSocietyResultsUrl({ nameOrSraId: sraId }),
    outcome: "parse_miss",
  };
  attempts.push(trace);

  try {
    const {
      lookupLawSocietyBySraId,
      lawSocietyResultToRegisterLookup,
      closeLawSocietyBrowser,
    } = await import("@/lib/sra/law-society-sra-recovery");

    const diag = await lookupLawSocietyBySraId(sraId, {
      postcodeHint: hints?.postcodeHint,
      displayNameHint: hints?.displayNameHint,
    });
    trace.url = diag.searchUrl;
    trace.parseNote = diag.captchaBlocked
      ? "captcha_blocked"
      : `result_count_${diag.resultCount}`;
    trace.parsedFields = {
      organisationName: diag.result?.organisationName,
      profileUrl: diag.result?.profileUrl,
      website: diag.result?.website,
      phone: diag.result?.phone,
      matchKind: diag.result?.matchKind,
      attempts: diag.attempts?.join("|"),
    };

    if (diag.resultCount > 1 && !diag.result) {
      trace.outcome = "rejected";
      trace.rejectReason = "multiple_matches";
      trace.parseNote = "multiple_results_ambiguous";
      await closeLawSocietyBrowser();
      return null;
    }

    if (!diag.result || diag.result.matchKind === "multiple") {
      trace.parseNote = diag.result?.matchKind ?? "not_found";
      await closeLawSocietyBrowser();
      return null;
    }

    trace.outcome = "success";
    trace.parseNote = diag.result.matchKind;
    trace.bodyPreview = diag.result.evidenceText.slice(0, 500);
    const mapped = lawSocietyResultToRegisterLookup(diag.result);
    await closeLawSocietyBrowser();
    return mapped;
  } catch (e) {
    trace.outcome = "exception";
    trace.error = e instanceof Error ? e.message : String(e);
    try {
      const { closeLawSocietyBrowser } = await import("@/lib/sra/law-society-sra-recovery");
      await closeLawSocietyBrowser();
    } catch {
      /* ignore */
    }
    return null;
  }
}

/** Full lookup with per-attempt HTTP/parser diagnostics. */
export async function lookupSraRegisterWithDiagnostics(
  sraId: string,
  opts?: { postcodeHint?: string },
): Promise<SraRegisterLookupDiagnostics> {
  const id = sraId.trim().replace(/^sra:/i, "");
  const attempts: SraLookupAttemptTrace[] = [];

  if (!/^\d{4,}$/.test(id)) {
    return {
      sraId: id,
      attempts,
      result: null,
      finalOutcome: "invalid_id",
    };
  }

  const fromLocal = await lookupFromSyncedPostgres(id, attempts);
  if (fromLocal && !fromLocal.rejectReason && fromLocal.displayName) {
    return { sraId: id, attempts, result: fromLocal, finalOutcome: "found" };
  }
  if (fromLocal?.rejectReason === "address_like_name") {
    return { sraId: id, attempts, result: fromLocal, finalOutcome: "address_like_name" };
  }

  let postcodeHint = opts?.postcodeHint;
  let displayNameHint: string | undefined;
  if (process.env.DATABASE_URL?.trim()) {
    try {
      const { prisma } = await import("@/lib/db/prisma");
      const row = await prisma.sraOrganisation.findFirst({
        where: { sraId: id },
        select: { postcode: true, displayName: true, businessName: true },
      });
      postcodeHint = postcodeHint ?? row?.postcode ?? undefined;
      displayNameHint = row?.displayName || row?.businessName || undefined;
    } catch {
      /* optional */
    }
  }

  if (process.env.SRA_REGISTER_USE_LAW_SOCIETY === "1") {
    const fromLawSoc = await lookupFromLawSociety(id, attempts, {
      postcodeHint,
      displayNameHint,
    });
    if (fromLawSoc && !fromLawSoc.rejectReason && fromLawSoc.displayName) {
      return { sraId: id, attempts, result: fromLawSoc, finalOutcome: "found" };
    }
  } else {
    attempts.push({
      channel: "law_society",
      url: "",
      outcome: "skipped",
      parseNote: "SRA_REGISTER_USE_LAW_SOCIETY not enabled (use --include-lawsociety on identity recovery CLI)",
    });
  }

  if (!apiHeaders()) {
    attempts.push({
      channel: "sra_api",
      url: DATASHARE_BASE,
      outcome: "skipped",
      parseNote: "SRA_APIM_SUBSCRIPTION_KEY not set",
    });
  } else if (process.env.SRA_REGISTER_LOOKUP_SKIP_API !== "1") {
    const fromApi = await fetchFromSraApi(id, attempts);
    if (fromApi && !fromApi.rejectReason && fromApi.displayName) {
      return { sraId: id, attempts, result: fromApi, finalOutcome: "found" };
    }
    if (fromApi?.rejectReason === "address_like_name") {
      return { sraId: id, attempts, result: fromApi, finalOutcome: "address_like_name" };
    }
  }

  const fromPage = await fetchFromSraRegisterPage(id, attempts);
  if (fromPage && !fromPage.rejectReason && fromPage.displayName) {
    return { sraId: id, attempts, result: fromPage, finalOutcome: "found" };
  }
  if (fromPage?.rejectReason === "address_like_name") {
    return { sraId: id, attempts, result: fromPage, finalOutcome: "address_like_name" };
  }

  const notFound: SraRegisterLookupResult = {
    sraId: id,
    sourceUrl: sraProfileUrlForId(id),
    fetchedAt: new Date().toISOString(),
    confidence: 0,
    source: "sra_register",
    rejectReason: "not_found",
  };

  return {
    sraId: id,
    attempts,
    result: notFound,
    finalOutcome: "not_found",
  };
}

/**
 * Official SRA Data Share API lookup only (identity recovery ladder step 2).
 * Does not use Postgres sync or Law Society.
 */
export async function lookupSraApiForIdentityRecovery(sraId: string): Promise<{
  result: SraRegisterLookupResult | null;
  api404: boolean;
  attempts: SraLookupAttemptTrace[];
}> {
  const id = sraId.trim().replace(/^sra:/i, "");
  const attempts: SraLookupAttemptTrace[] = [];

  if (!/^\d{4,}$/.test(id)) {
    return { result: null, api404: false, attempts };
  }

  if (!apiHeaders()) {
    attempts.push({
      channel: "sra_api",
      url: DATASHARE_BASE,
      outcome: "skipped",
      parseNote: "SRA_APIM_SUBSCRIPTION_KEY not set",
    });
    return { result: null, api404: false, attempts };
  }

  if (process.env.SRA_REGISTER_LOOKUP_SKIP_API === "1") {
    attempts.push({
      channel: "sra_api",
      url: "(skipped)",
      outcome: "skipped",
      parseNote: "SRA_REGISTER_LOOKUP_SKIP_API=1",
    });
    return { result: null, api404: false, attempts };
  }

  const fromApi = await fetchFromSraApi(id, attempts);

  const api404 =
    !fromApi &&
    attempts.some((a) => a.channel === "sra_api" && a.parseNote === "http_404") &&
    !attempts.some((a) => a.channel === "sra_api" && a.outcome === "success");

  if (fromApi?.rejectReason === "address_like_name") {
    return { result: fromApi, api404: false, attempts };
  }

  if (fromApi?.displayName && !fromApi.rejectReason) {
    return {
      result: { ...fromApi, confidence: Math.max(fromApi.confidence, 0.95) },
      api404: false,
      attempts,
    };
  }

  return { result: null, api404, attempts };
}

/** Look up firm identity from SRA organisation number (API then consumer register page). */
export async function lookupSraRegisterByOrganisationId(
  sraId: string,
): Promise<SraRegisterLookupResult | null> {
  const diag = await lookupSraRegisterWithDiagnostics(sraId);
  return diag.result;
}

export function registerLookupUrlForId(sraId: string): string {
  return sraProfileUrlForId(sraId);
}
