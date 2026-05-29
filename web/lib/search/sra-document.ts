import { resolveSraDisplayName } from "@/lib/search/sra-display";

/** Shape stored in Meilisearch and returned to the UI for SRA-sourced rows. */
export type SraMeiliDocument = {
  id: string;
  businessName: string;
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

function resolveBusinessName(raw: Record<string, unknown>, sraId: string, offices: unknown[]): string {
  const candidates = [
    asString(
      pick(raw, [
        "AuthorisedName",
        "authorisedName",
        "OrganisationName",
        "organisationName",
        "PracticeName",
        "practiceName",
        "RegisteredName",
        "registeredName",
        "CompanyName",
        "companyName",
        "FirmName",
        "firmName",
        "OfficeName",
        "officeName",
        "Name",
        "name",
      ]),
    ),
    firstTradingName(raw),
    officeField(offices, ["OfficeName", "officeName", "OrganisationName", "organisationName"]),
    asString(pick(raw, ["TradingAs", "tradingAs"])),
  ].filter(Boolean);

  for (const c of candidates) {
    if (!looksLikeOrganisationNumber(c)) return c;
  }
  return "";
}

function collectOfficeStrings(office: Record<string, unknown>): string[] {
  const parts: string[] = [];
  const lineKeys = [
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
  const orgId = pick(raw, [
    "OrganisationId",
    "organisationId",
    "OrganisationID",
    "organisationID",
    "Id",
    "id",
  ]);
  if (orgId == null) return null;

  const sraId = asString(orgId);
  const id = `sra-${sraId}`;

  const officesRaw = raw.Offices ?? raw.offices ?? raw.OfficeList ?? raw.officeList ?? [];
  const offices = Array.isArray(officesRaw) ? officesRaw : officesRaw ? [officesRaw] : [];

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

  const searchText = [businessName, sraId, ...tradingParts, phone, ...officeBlocks, ...practiceExtra]
    .filter(Boolean)
    .join("\n");

  if (!businessName && !searchText) return null;

  const storedName = businessName || `Organisation ${sraId}`;

  return {
    id,
    businessName: resolveSraDisplayName(storedName, searchText, sraId),
    searchText,
    sraId,
    phone,
    city,
    postcode,
    county,
    country,
    source: "sra",
    sraProfileUrl: sraProfileUrlForId(sraId),
  };
}
