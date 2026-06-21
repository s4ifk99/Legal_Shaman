import { pickSraIndexTitle } from "@/lib/search/sra-name-fields";

/** Shape stored in Meilisearch and returned to the UI for SRA-sourced rows. */
export type SraMeiliDocument = {
  id: string;
  businessName: string;
  displayName: string;
  organisationName: string;
  tradingName: string;
  firmName: string;
  searchText: string;
  sraId: string;
  phone: string;
  city: string;
  postcode: string;
  county: string;
  country: string;
  source: "sra";
  /** Best-effort deep link; verify against current SRA consumer pages. */
  sraProfileUrl: string;
  /** From SRA register (office or org-level Websites). */
  website?: string;
  email?: string;
  authorisationStatus?: string;
};

/** Normalised SRA office row (all offices persisted). */
export type SraOfficeRecord = {
  officeId: string;
  name: string;
  address1: string;
  address2: string;
  address3: string;
  address4: string;
  postcode: string;
  town: string;
  county: string;
  country: string;
  phoneNumber: string;
  website: string;
  email: string;
  officeType: string;
};

/** Full v2 sync record — Postgres system of record + index source. */
export type SraV2Record = SraMeiliDocument & {
  tradingNames: string[];
  previousNames: string[];
  workArea: string[];
  offices: SraOfficeRecord[];
  rawPayload: Record<string, unknown>;
};

export type SraRawNameFields = {
  tradingName: string;
  organisationName: string;
  firmName: string;
  name: string;
  authorisationName: string;
  recognisedBodyName: string;
};

export function sraProfileUrlForId(sraId: string): string {
  const q = encodeURIComponent(String(sraId).trim());
  return `https://www.sra.org.uk/consumers/solicitor-check/?searchType=Organisation&searchText=${q}`;
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== "") return v;
  }
  return undefined;
}

function asString(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/** Prefer public SRA number over internal Data Share row id. */
function resolveSraId(raw: Record<string, unknown>): string {
  const v = pick(raw, [
    "SraNumber",
    "sraNumber",
    "OrganisationId",
    "organisationId",
    "OrganisationID",
    "organisationID",
    "Id",
    "id",
  ]);
  return v == null ? "" : asString(v);
}

function normaliseWebsiteUrl(value: string): string {
  const t = value.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t.replace(/^\/\//, "")}`;
}

function collectWebsites(raw: Record<string, unknown>, offices: unknown[]): string {
  const urls: string[] = [];
  const orgSites = raw.Websites ?? raw.websites ?? raw.Website ?? raw.website;
  if (Array.isArray(orgSites)) {
    for (const w of orgSites) {
      const s = asString(w);
      if (s) urls.push(normaliseWebsiteUrl(s));
    }
  } else {
    const s = asString(orgSites);
    if (s) urls.push(normaliseWebsiteUrl(s));
  }
  for (const o of offices) {
    if (!o || typeof o !== "object") continue;
    const office = o as Record<string, unknown>;
    const s = asString(pick(office, ["Website", "website", "WebsiteAddress", "websiteAddress"]));
    if (s) urls.push(normaliseWebsiteUrl(s));
  }
  return urls.find(Boolean) ?? "";
}

function collectEmail(raw: Record<string, unknown>, offices: unknown[]): string {
  const top = asString(pick(raw, ["Email", "email", "BusinessEmail", "businessEmail"]));
  if (top) return top;
  return officeField(offices, ["Email", "email", "BusinessEmail", "businessEmail"]);
}

function looksLikeOrganisationNumber(value: string): boolean {
  return /^\d{4,}$/.test(value.trim());
}

function firstTradingName(raw: Record<string, unknown>): string {
  const trading = raw.TradingNames ?? raw.tradingNames ?? raw.TradingName ?? raw.tradingName;
  if (Array.isArray(trading)) {
    for (const t of trading) {
      if (typeof t === "string" && t.trim() && !looksLikeOrganisationNumber(t)) return t.trim();
      if (t && typeof t === "object") {
        const label = asString(
          pick(t as Record<string, unknown>, ["Name", "name", "TradingName", "tradingName"]),
        );
        if (label && !looksLikeOrganisationNumber(label)) return label;
      }
    }
    return "";
  }
  const ts = asString(trading);
  return ts && !looksLikeOrganisationNumber(ts) ? ts : "";
}

function officeField(
  offices: unknown[],
  fieldKeys: string[],
): string {
  for (const o of offices) {
    if (!o || typeof o !== "object") continue;
    const office = o as Record<string, unknown>;
    const v = asString(pick(office, fieldKeys));
    if (v) return v;
  }
  return "";
}

export function extractSraRawNameFields(
  raw: Record<string, unknown>,
  offices: unknown[],
): SraRawNameFields {
  return {
    tradingName:
      firstTradingName(raw) ||
      asString(pick(raw, ["TradingName", "tradingName", "TradingAs", "tradingAs"])),
    organisationName: asString(
      pick(raw, [
        "PracticeName",
        "practiceName",
        "OrganisationName",
        "organisationName",
        "AuthorisedName",
        "authorisedName",
        "RegisteredName",
        "registeredName",
        "CompanyName",
        "companyName",
        "OfficeName",
        "officeName",
        "Name",
        "name",
      ]),
    ),
    firmName: asString(pick(raw, ["FirmName", "firmName"])),
    name: asString(pick(raw, ["Name", "name"])),
    authorisationName: asString(
      pick(raw, ["AuthorisationName", "authorisationName", "AuthorizationName", "authorizationName"]),
    ),
    recognisedBodyName: asString(
      pick(raw, ["RecognisedBodyName", "recognisedBodyName", "RecognizedBodyName", "recognizedBodyName"]),
    ),
  };
}

function resolveBusinessName(raw: Record<string, unknown>, sraId: string, offices: unknown[]): string {
  const fields = extractSraRawNameFields(raw, offices);
  const officeOrg = officeField(offices, [
    "Name",
    "name",
    "OfficeName",
    "officeName",
    "OrganisationName",
    "organisationName",
  ]);
  const candidates = [
    fields.tradingName,
    fields.organisationName,
    fields.firmName,
    fields.name,
    fields.authorisationName,
    fields.recognisedBodyName,
    officeOrg,
  ].filter(Boolean);

  for (const c of candidates) {
    if (!looksLikeOrganisationNumber(c)) return c;
  }
  return "";
}

function collectOfficeStrings(office: Record<string, unknown>): string[] {
  const parts: string[] = [];
  const lineKeys = [
    "Address1",
    "address1",
    "Address2",
    "address2",
    "Address3",
    "address3",
    "Address4",
    "address4",
    "AddressLine1",
    "addressLine1",
    "AddressLine2",
    "addressLine2",
    "AddressLine3",
    "Street",
    "street",
  ];
  for (const k of lineKeys) {
    const s = asString(office[k]);
    if (s) parts.push(s);
  }
  const town = asString(
    pick(office, ["PostTown", "postTown", "Town", "town", "City", "city"]),
  );
  const county = asString(pick(office, ["County", "county", "Region", "region"]));
  const pc = asString(pick(office, ["PostCode", "postCode", "postcode", "Postcode"]));
  const country = asString(pick(office, ["Country", "country"]));
  if (town) parts.push(town);
  if (county) parts.push(county);
  if (pc) parts.push(pc);
  if (country) parts.push(country);
  return parts;
}

/**
 * Map one SRA API organisation object to a Meilisearch document.
 * Tolerant of naming variants; extend when you inspect a live GetAll payload.
 */
export function normaliseSraOrganisation(raw: Record<string, unknown>): SraMeiliDocument | null {
  const sraId = resolveSraId(raw);
  if (!sraId) return null;
  const id = `sra-${sraId}`;

  const officesRaw = raw.Offices ?? raw.offices ?? raw.OfficeList ?? raw.officeList ?? [];
  const offices = Array.isArray(officesRaw) ? officesRaw : officesRaw ? [officesRaw] : [];

  const rawNames = extractSraRawNameFields(raw, offices);
  const businessName = resolveBusinessName(raw, sraId, offices);

  const trading = raw.TradingNames ?? raw.tradingNames ?? raw.TradingName ?? raw.tradingName;
  const tradingParts: string[] = [];
  if (Array.isArray(trading)) {
    for (const t of trading) {
      if (typeof t === "string") tradingParts.push(asString(t));
      else if (t && typeof t === "object") {
        const label = asString(
          pick(t as Record<string, unknown>, ["Name", "name", "TradingName", "tradingName"]),
        );
        if (label) tradingParts.push(label);
      }
    }
  } else {
    const ts = asString(trading);
    if (ts) tradingParts.push(ts);
  }

  const phone = officeField(offices, [
    "Telephone",
    "telephone",
    "Phone",
    "phone",
    "PhoneNumber",
    "phoneNumber",
    "Tel",
    "tel",
    "MainTelephone",
    "mainTelephone",
    "BusinessTelephone",
    "businessTelephone",
    "ContactTelephone",
    "contactTelephone",
  ]);

  const officeBlocks: string[] = [];
  let city = "";
  let postcode = "";
  let county = "";
  let country = "";

  for (const o of offices) {
    if (!o || typeof o !== "object") continue;
    const office = o as Record<string, unknown>;
    officeBlocks.push(collectOfficeStrings(office).join(", "));
    if (!city)
      city = asString(
        pick(office, ["PostTown", "postTown", "Town", "town", "City", "city"]),
      );
    if (!postcode)
      postcode = asString(pick(office, ["PostCode", "postCode", "postcode", "Postcode"]));
    if (!county) county = asString(pick(office, ["County", "county"]));
    if (!country) country = asString(pick(office, ["Country", "country"]));
  }

  const practiceExtra: string[] = [];
  const pa = raw.PracticeAreas ?? raw.practiceAreas ?? raw.AreasOfLaw ?? raw.areasOfLaw;
  if (Array.isArray(pa)) {
    for (const p of pa) {
      if (typeof p === "string" && p.trim()) practiceExtra.push(p.trim());
      else if (p && typeof p === "object") {
        const po = p as Record<string, unknown>;
        const label = asString(
          pick(po, ["Name", "name", "Description", "description", "AreaOfLaw", "areaOfLaw"]),
        );
        if (label) practiceExtra.push(label);
      }
    }
  }
  const workArea = raw.WorkArea ?? raw.workArea;
  if (typeof workArea === "string" && workArea.trim()) practiceExtra.push(workArea.trim());
  else if (Array.isArray(workArea)) {
    for (const w of workArea) {
      const label = typeof w === "string" ? asString(w) : asString(pick(w as Record<string, unknown>, ["Name", "name"]));
      if (label) practiceExtra.push(label);
    }
  }

  const website = collectWebsites(raw, offices);
  const email = collectEmail(raw, offices);
  const authorisationStatus = asString(
    pick(raw, ["AuthorisationStatus", "authorisationStatus", "IsAuthorised", "isAuthorised"]),
  );

  const searchText = [
    businessName,
    sraId,
    ...tradingParts,
    phone,
    email,
    website,
    authorisationStatus,
    ...officeBlocks,
    ...practiceExtra,
  ]
    .filter(Boolean)
    .join("\n");

  if (!businessName && !searchText) return null;

  const displayName = pickSraIndexTitle(sraId, searchText, {
    tradingName: rawNames.tradingName,
    organisationName: rawNames.organisationName || businessName,
    firmName: rawNames.firmName,
    name: rawNames.name,
    authorisationName: rawNames.authorisationName,
    recognisedBodyName: rawNames.recognisedBodyName,
    businessName,
  });

  return {
    id,
    businessName: displayName,
    displayName,
    organisationName: rawNames.organisationName || businessName,
    tradingName: rawNames.tradingName,
    firmName: rawNames.firmName,
    searchText,
    sraId,
    phone,
    city,
    postcode,
    county,
    country,
    source: "sra",
    sraProfileUrl: sraProfileUrlForId(sraId),
    ...(website ? { website } : {}),
    ...(email ? { email } : {}),
    ...(authorisationStatus ? { authorisationStatus } : {}),
  };
}

function stringListFromApi(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") {
    const t = value.trim();
    return t ? [t] : [];
  }
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const t = item.trim();
      if (t) out.push(t);
    } else if (item && typeof item === "object") {
      const label = asString(
        pick(item as Record<string, unknown>, [
          "Name",
          "name",
          "TradingName",
          "tradingName",
          "Description",
          "description",
          "AreaOfLaw",
          "areaOfLaw",
        ]),
      );
      if (label) out.push(label);
    }
  }
  return out;
}

/** SRA register work areas and practice-area metadata (WorkArea + PracticeAreas). */
export function collectSraWorkAreaLabels(raw: Record<string, unknown>): string[] {
  const labels = [
    ...stringListFromApi(raw.WorkArea ?? raw.workArea),
    ...stringListFromApi(raw.PracticeAreas ?? raw.practiceAreas ?? raw.AreasOfLaw ?? raw.areasOfLaw),
  ];
  return [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
}

export function normaliseSraOffices(offices: unknown[]): SraOfficeRecord[] {
  const out: SraOfficeRecord[] = [];
  for (const o of offices) {
    if (!o || typeof o !== "object") continue;
    const office = o as Record<string, unknown>;
    const websiteRaw = asString(
      pick(office, ["Website", "website", "WebsiteAddress", "websiteAddress"]),
    );
    out.push({
      officeId: asString(office.OfficeId ?? office.officeId),
      name: asString(office.Name ?? office.name ?? office.OfficeName ?? office.officeName),
      address1: asString(office.Address1 ?? office.address1 ?? office.AddressLine1 ?? office.addressLine1),
      address2: asString(office.Address2 ?? office.address2 ?? office.AddressLine2 ?? office.addressLine2),
      address3: asString(office.Address3 ?? office.address3 ?? office.AddressLine3 ?? office.addressLine3),
      address4: asString(office.Address4 ?? office.address4),
      postcode: asString(pick(office, ["PostCode", "postCode", "postcode", "Postcode"])),
      town: asString(pick(office, ["PostTown", "postTown", "Town", "town", "City", "city"])),
      county: asString(pick(office, ["County", "county", "Region", "region"])),
      country: asString(pick(office, ["Country", "country"])),
      phoneNumber: asString(
        pick(office, [
          "PhoneNumber",
          "phoneNumber",
          "Telephone",
          "telephone",
          "Phone",
          "phone",
        ]),
      ),
      website: websiteRaw ? normaliseWebsiteUrl(websiteRaw) : "",
      email: asString(pick(office, ["Email", "email", "BusinessEmail", "businessEmail"])),
      officeType: asString(office.OfficeType ?? office.officeType),
    });
  }
  return out;
}

/** Map one SRA API organisation to a v2 Postgres + index record (includes raw JSON). */
export function normaliseSraOrganisationV2(raw: Record<string, unknown>): SraV2Record | null {
  const base = normaliseSraOrganisation(raw);
  if (!base) return null;

  const officesRaw = raw.Offices ?? raw.offices ?? raw.OfficeList ?? raw.officeList ?? [];
  const officesList = Array.isArray(officesRaw) ? officesRaw : officesRaw ? [officesRaw] : [];
  const offices = normaliseSraOffices(officesList);

  const tradingNames = stringListFromApi(raw.TradingNames ?? raw.tradingNames ?? raw.TradingName ?? raw.tradingName);
  const previousNames = stringListFromApi(raw.PreviousNames ?? raw.previousNames);
  const workArea = collectSraWorkAreaLabels(raw);

  const website = base.website ?? collectWebsites(raw, officesList);
  const email = base.email ?? collectEmail(raw, officesList);
  const authorisationStatus =
    base.authorisationStatus ??
    asString(pick(raw, ["AuthorisationStatus", "authorisationStatus", "IsAuthorised", "isAuthorised"]));

  return {
    ...base,
    website,
    email,
    authorisationStatus,
    tradingNames,
    previousNames,
    workArea,
    offices,
    rawPayload: raw,
  };
}

/** Public SRA number for ordering resume checkpoints. */
export function sraNumberFromRaw(raw: Record<string, unknown>): string {
  return resolveSraId(raw);
}

export function sraNumberSortKey(sraNumber: string): number {
  const n = Number(sraNumber);
  return Number.isFinite(n) ? n : 0;
}
