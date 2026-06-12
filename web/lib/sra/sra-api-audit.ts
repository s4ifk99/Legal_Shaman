import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  extractSraRawNameFields,
  normaliseSraOrganisation,
  type SraMeiliDocument,
} from "@/lib/search/sra-document";
import { documentToTypesenseRecord, sraOrganisationToDocument } from "@/lib/search-index/build-legal-entity-doc";

/** Fields we intentionally read today (see lib/search/sra-document.ts). */
export const SRA_FIELDS_WE_MAP = {
  organisation: [
    "SraNumber",
    "sraNumber",
    "Id",
    "id",
    "OrganisationId",
    "organisationId",
    "PracticeName",
    "practiceName",
    "AuthorisedName",
    "authorisedName",
    "OrganisationName",
    "organisationName",
    "TradingName",
    "TradingNames",
    "tradingName",
    "tradingNames",
    "PracticeAreas",
    "practiceAreas",
    "AreasOfLaw",
    "areasOfLaw",
    "WorkArea",
    "workArea",
    "Websites",
    "websites",
    "AuthorisationStatus",
    "authorisationStatus",
    "FirmName",
    "firmName",
    "Name",
    "name",
    "AuthorisationName",
    "RecognisedBodyName",
    "Offices",
    "offices",
  ],
  office: [
    "PhoneNumber",
    "phoneNumber",
    "Telephone",
    "Phone",
    "Town",
    "town",
    "PostTown",
    "Postcode",
    "postcode",
    "PostCode",
    "County",
    "Country",
    "Address1",
    "Address2",
    "AddressLine1",
    "AddressLine2",
    "Name",
    "OfficeName",
    "Website",
    "Email",
  ],
} as const;

/** Published SRA Data Share fields we do NOT persist or index structurally (Jun 2024 terms). */
export const SRA_FIELDS_WE_DO_NOT_MAP: { field: string; indexImpact: string }[] = [
  { field: "Website / WebsiteAddress", indexImpact: "no website on SRA org rows; crawler must discover" },
  { field: "Email / BusinessEmail", indexImpact: "no email; enrichment/crawl only" },
  { field: "AuthorisationStatus / IsAuthorised", indexImpact: "cannot filter authorised vs closed" },
  { field: "AuthorisationDate", indexImpact: "no freshness signal in index" },
  { field: "LicenceType / ConstitutionType", indexImpact: "no LLP vs partnership metadata" },
  { field: "OfficeType (head vs branch)", indexImpact: "only first office used for geo/phone" },
  { field: "ReservedActivities", indexImpact: "not in practiceAreaSlugs or capabilities" },
  { field: "CompanyRegistrationNumber", indexImpact: "no Companies House link" },
  { field: "PreviousNames", indexImpact: "name recovery harder for rebrands" },
  { field: "NumberOfOffices", indexImpact: "branch firms under-represented" },
  { field: "Freelance / Regulator", indexImpact: "no entity subtype in search" },
  { field: "AreasOfLaw (structured)", indexImpact: "concatenated into searchText only, not practiceAreaSlugs" },
];

export type SraApiAuditSample = {
  source: "live_getall" | "file" | "database_derived";
  organisationCount: number;
  /** Top-level + nested keys seen in raw payloads. */
  keysSeen: string[];
  /** Keys present in ≥1% of sampled orgs. */
  frequentKeys: { key: string; pct: number }[];
  mappedKeysHit: string[];
  unmappedKeys: { key: string; sampleValues: string[] }[];
  normalisation: {
    parsed: number;
    dropped: number;
    placeholderNames: number;
  };
  indexGaps: {
    field: string;
    inDb: boolean;
    inTypesensePatch: boolean;
    notes: string;
  }[];
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function collectKeys(value: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (value == null) return out;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 3)) {
      collectKeys(item, prefix ? `${prefix}[]` : "[]", out);
    }
    return out;
  }
  const rec = asRecord(value);
  if (!rec) {
    if (prefix) out.add(prefix);
    return out;
  }
  for (const [k, v] of Object.entries(rec)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.add(path);
    if (v && typeof v === "object") collectKeys(v, path, out);
  }
  return out;
}

function sampleValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.slice(0, 80);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[array:${v.length}]`;
  return "[object]";
}

const MAPPED_PATH_HINTS = [
  ...SRA_FIELDS_WE_MAP.organisation,
  ...SRA_FIELDS_WE_MAP.office,
  "OrganisationID",
  "OfficeList",
  "officeList",
  "TradingAs",
  "PracticeName",
  "RegisteredName",
  "CompanyName",
  "AuthorizationName",
  "Street",
  "addressLine",
  "Postcode",
  "postcode",
  "Town",
  "town",
  "City",
  "city",
  "Tel",
  "tel",
  "PhoneNumber",
  "MainTelephone",
  "ContactTelephone",
  "Description",
  "AreaOfLaw",
  "areaOfLaw",
];

function isMappedKey(path: string): boolean {
  const leaf = path.split(".").pop() ?? path;
  return MAPPED_PATH_HINTS.some((h) => leaf === h || path.includes(h));
}

export function auditRawOrganisations(
  rows: unknown[],
  source: SraApiAuditSample["source"],
): SraApiAuditSample {
  const keyCounts = new Map<string, number>();
  const keySamples = new Map<string, Set<string>>();
  let parsed = 0;
  let dropped = 0;
  let placeholderNames = 0;

  for (const row of rows) {
    const rec = asRecord(row);
    if (!rec) continue;
    for (const k of collectKeys(rec)) {
      keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
      if (!keySamples.has(k)) keySamples.set(k, new Set());
      const leaf = k.split(".").pop() ?? k;
      const parts = k.split(".");
      let val: unknown = rec;
      for (const part of parts) {
        if (val && typeof val === "object") {
          val = (val as Record<string, unknown>)[part.replace(/\[\]$/, "")];
          if (Array.isArray(val)) val = val[0];
        }
      }
      if (!parts[0] || parts[0] === k) val = rec[leaf];
      const s = sampleValue(val);
      if (s && (keySamples.get(k)!.size < 3)) keySamples.get(k)!.add(s);
    }

    const doc = normaliseSraOrganisation(rec);
    if (!doc) {
      dropped++;
      continue;
    }
    parsed++;
    if (/^SRA organisation\s/i.test(doc.displayName)) placeholderNames++;
  }

  const n = rows.length || 1;
  const frequentKeys = [...keyCounts.entries()]
    .map(([key, count]) => ({ key, pct: Math.round((count / n) * 1000) / 10 }))
    .filter((e) => e.pct >= 1)
    .sort((a, b) => b.pct - a.pct);

  const keysSeen = [...keyCounts.keys()].sort();
  const mappedKeysHit = keysSeen.filter(isMappedKey);
  const unmappedKeys = keysSeen
    .filter((k) => !isMappedKey(k))
    .slice(0, 40)
    .map((key) => ({
      key,
      sampleValues: [...(keySamples.get(key) ?? [])].slice(0, 3),
    }));

  const mockDoc: SraMeiliDocument = {
    id: "sra-audit",
    businessName: "Audit Firm",
    displayName: "Audit Firm",
    organisationName: "Audit Firm",
    tradingName: "",
    firmName: "",
    searchText: "Employment law London",
    sraId: "9999999",
    phone: "02070000000",
    city: "London",
    postcode: "EC1A 1BB",
    county: "",
    country: "United Kingdom",
    source: "sra",
    sraProfileUrl: "https://www.sra.org.uk/",
  };

  const indexGaps = [
    {
      field: "website",
      inDb: false,
      inTypesensePatch: true,
      notes: "Not extracted from SRA API; regex from searchText only at index time",
    },
    {
      field: "email",
      inDb: false,
      inTypesensePatch: true,
      notes: "SRA publishes business email; we never map it",
    },
    {
      field: "practiceAreaSlugs (from API AreasOfLaw)",
      inDb: false,
      inTypesensePatch: true,
      notes: "API areas go to searchText; slugs from projection heuristics only",
    },
    {
      field: "authorisationStatus",
      inDb: false,
      inTypesensePatch: false,
      notes: "Cannot exclude closed/unauthorised firms in search",
    },
    {
      field: "allOffices[]",
      inDb: false,
      inTypesensePatch: false,
      notes: "Only first office phone/address kept",
    },
    {
      field: "rawPayload",
      inDb: false,
      inTypesensePatch: false,
      notes: "Raw JSON not stored — cannot re-map without full re-sync",
    },
  ];

  return {
    source,
    organisationCount: rows.length,
    keysSeen,
    frequentKeys,
    mappedKeysHit,
    unmappedKeys,
    normalisation: { parsed, dropped, placeholderNames },
    indexGaps,
  };
}

export async function loadSampleOrganisationsFromFile(): Promise<unknown[]> {
  const p = path.join(process.cwd(), "data/sra-organisation-sample.json");
  const raw = await readFile(p, "utf8");
  const j = JSON.parse(raw) as unknown;
  return Array.isArray(j) ? j : [];
}

export async function fetchGetAllSample(
  key: string,
  limit = 200,
): Promise<{ rows: unknown[]; pages: number }> {
  const startUrl =
    process.env.SRA_ORGANISATIONS_URL?.trim() ||
    "https://sra-prod-apim.azure-api.net/datashare/api/V1/organisation/GetAll";

  const rows: unknown[] = [];
  let url: string | null = startUrl;
  let pages = 0;

  while (url && rows.length < limit) {
    pages++;
    const res = await fetch(url, {
      headers: { "Ocp-Apim-Subscription-Key": key },
    });
    if (!res.ok) {
      throw new Error(`SRA HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const body: unknown = await res.json();
    if (Array.isArray(body)) {
      rows.push(...body.slice(0, limit - rows.length));
      break;
    }
    if (body && typeof body === "object") {
      const o = body as Record<string, unknown>;
      for (const k of ["value", "items", "data", "organisations", "Organisations"]) {
        const v = o[k];
        if (Array.isArray(v)) {
          rows.push(...v.slice(0, limit - rows.length));
          break;
        }
      }
      const next =
        (typeof o.nextLink === "string" && o.nextLink) ||
        (typeof o.NextLink === "string" && o.NextLink) ||
        null;
      url = rows.length < limit ? next : null;
    } else {
      break;
    }
  }

  return { rows, pages };
}

export async function compareIndexShapeFromDbRow(
  org: Parameters<typeof sraOrganisationToDocument>[0],
): Promise<{
  dbFields: string[];
  indexFields: string[];
  emptyInIndex: string[];
}> {
  const doc = await sraOrganisationToDocument(org, { skipGeo: true });
  const ts = documentToTypesenseRecord(doc);
  const dbFields = Object.keys(org).filter((k) => {
    const v = (org as Record<string, unknown>)[k];
    return v != null && v !== "" && v !== 0;
  });
  const indexFields = Object.keys(ts);
  const important = [
    "phone",
    "city",
    "postcode",
    "practiceAreaSlugs",
    "website",
    "email",
    "latitude",
    "longitude",
  ];
  const emptyInIndex = important.filter((f) => {
    const v = ts[f];
    return v == null || v === "" || (Array.isArray(v) && v.length === 0);
  });
  return { dbFields, indexFields, emptyInIndex };
}

export function summariseNameFields(raw: Record<string, unknown>): ReturnType<typeof extractSraRawNameFields> {
  const offices = raw.Offices ?? raw.offices ?? [];
  const list = Array.isArray(offices) ? offices : [];
  return extractSraRawNameFields(raw, list);
}
