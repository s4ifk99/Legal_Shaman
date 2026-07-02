import {
  collectSraWorkAreaLabels,
  normaliseSraOffices,
  type SraV2Record,
} from "@/lib/search/sra-document";

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

function stringListFromApi(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        if (typeof item === "string") return [item.trim()];
        if (item && typeof item === "object") {
          const label = asString(
            pick(item as Record<string, unknown>, [
              "Name",
              "name",
              "Description",
              "description",
              "AreaOfLaw",
              "areaOfLaw",
              "Activity",
              "activity",
            ]),
          );
          return label ? [label] : [];
        }
        return [];
      })
      .filter(Boolean);
  }
  const single = asString(value);
  return single ? [single] : [];
}

function formatDate(value: unknown): string {
  const raw = asString(value);
  if (!raw) return "—";
  return raw.slice(0, 10) || raw;
}

function yesNoUnknown(value: unknown): string {
  const v = asString(value).toUpperCase();
  if (!v) return "—";
  if (v === "YES" || v === "TRUE" || v === "Y") return "Yes";
  if (v === "NO" || v === "FALSE" || v === "N") return "No";
  return asString(value);
}

const AUTHORISATION_TYPE_LABELS: Record<string, string> = {
  RECBODY: "Recognised body",
  LICBODY: "Licensed body",
  RECSOLE: "Recognised sole practitioner",
  "NOTSRA-F": "Not SRA-authorised firm",
  NOTSRA: "Not SRA-authorised",
};

const CONSTITUTION_LABELS: Record<string, string> = {
  ILLP: "Incorporated limited liability partnership (LLP)",
  ICLS: "Incorporated as a limited company",
  LLB: "Limited liability partnership",
  PART: "Partnership",
  SOLE: "Sole practitioner",
  FS: "Freelance solicitor",
  LTD: "Limited company",
};

const OFFICE_TYPE_LABELS: Record<string, string> = {
  HO: "Head office",
  BRANCH: "Branch",
  BR: "Branch",
};

function labelFrom(map: Record<string, string>, code: string): string {
  if (!code) return "—";
  return map[code.toUpperCase()] ?? map[code] ?? code;
}

function humanizeType(value: string): string {
  if (!value) return "—";
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
}

const UK_NATIONS = new Set(["England", "Wales", "Scotland", "Northern Ireland"]);

function officesFromRaw(record: SraV2Record): Record<string, unknown>[] {
  const raw = record.rawPayload;
  const officesRaw = raw.Offices ?? raw.offices ?? raw.OfficeList ?? raw.officeList ?? [];
  const list = Array.isArray(officesRaw) ? officesRaw : officesRaw ? [officesRaw] : [];
  return list.filter((o): o is Record<string, unknown> => Boolean(o) && typeof o === "object");
}

/** Human-readable business type from Raw API `Type` (fallback: AuthorisationType). */
export function extractBusinessTypeLabel(record: SraV2Record): string {
  const raw = record.rawPayload;
  const businessType = asString(pick(raw, ["Type", "type"]));
  if (businessType) return humanizeType(businessType);
  const authorisationType = asString(pick(raw, ["AuthorisationType", "authorisationType"]));
  if (authorisationType) return labelFrom(AUTHORISATION_TYPE_LABELS, authorisationType);
  return "Unspecified";
}

/** Location labels from Raw office practising addresses (town → county → country). */
export function extractRawLocations(record: SraV2Record): string[] {
  const locations = new Set<string>();
  for (const office of officesFromRaw(record)) {
    const town = asString(pick(office, ["Town", "town", "PostTown", "postTown", "City", "city"]));
    const county = asString(pick(office, ["County", "county", "Region", "region"]));
    const country = asString(pick(office, ["Country", "country"]));

    if (town) {
      locations.add(
        country && !UK_NATIONS.has(country) ? `${town}, ${country}` : town,
      );
    } else if (county) {
      locations.add(country && !UK_NATIONS.has(country) ? `${county}, ${country}` : county);
    } else if (country) {
      locations.add(country);
    }
  }
  return locations.size ? [...locations] : ["Unspecified"];
}

export function extractCurrentLicenceLabel(record: SraV2Record): string {
  const raw = record.rawPayload;
  const authorisationType = asString(pick(raw, ["AuthorisationType", "authorisationType"]));
  return authorisationType
    ? labelFrom(AUTHORISATION_TYPE_LABELS, authorisationType)
    : "Unspecified";
}

function formatAddressLines(parts: string[]): string {
  const lines = parts.filter(Boolean);
  return lines.length ? lines.join(", ") : "—";
}

function officePractisingAddress(office: Record<string, unknown>): string {
  return formatAddressLines([
    asString(pick(office, ["Address1", "address1", "AddressLine1", "addressLine1"])),
    asString(pick(office, ["Address2", "address2", "AddressLine2", "addressLine2"])),
    asString(pick(office, ["Address3", "address3", "AddressLine3", "addressLine3"])),
    asString(pick(office, ["Address4", "address4"])),
    asString(pick(office, ["Town", "town", "PostTown", "postTown", "City", "city"])),
    asString(pick(office, ["County", "county", "Region", "region"])),
    asString(pick(office, ["Postcode", "postcode", "PostCode", "postCode"])),
    asString(pick(office, ["Country", "country"])),
  ]);
}

function officePostalAddress(office: Record<string, unknown>): string {
  const dedicated = formatAddressLines([
    asString(pick(office, ["PostalAddress1", "postalAddress1"])),
    asString(pick(office, ["PostalAddress2", "postalAddress2"])),
    asString(pick(office, ["PostalAddress3", "postalAddress3"])),
    asString(pick(office, ["PostalAddress4", "postalAddress4"])),
    asString(pick(office, ["PostalTown", "postalTown"])),
    asString(pick(office, ["PostalPostcode", "postalPostcode"])),
    asString(pick(office, ["PostalCountry", "postalCountry"])),
  ]);
  if (dedicated !== "—") return dedicated;
  return "Not separately listed in SRA API (practising address used)";
}

function bullet(label: string, value: string): string {
  return `- **${label}:** ${value || "—"}`;
}

function bulletList(label: string, values: string[]): string {
  if (!values.length) return `- **${label}:** —`;
  if (values.length === 1) return bullet(label, values[0]!);
  return [`- **${label}:**`, ...values.map((v) => `  - ${v}`)].join("\n");
}

export function buildStructuredSraRawMarkdown(
  record: SraV2Record,
  title: string,
  importedAt: string,
): string {
  const raw = record.rawPayload;
  const officesList = officesFromRaw(record);

  const firmSraNumber = record.sraId;
  const practiceName =
    asString(pick(raw, ["PracticeName", "practiceName", "Name", "name"])) || record.businessName;
  const authorisationType = asString(pick(raw, ["AuthorisationType", "authorisationType"]));
  const organisationType = asString(pick(raw, ["OrganisationType", "organisationType"]));
  const businessType = asString(pick(raw, ["Type", "type"]));
  const constitution = asString(
    pick(raw, ["Constitution", "constitution", "ConstitutionType", "constitutionType"]),
  );
  const authorisationStatus = asString(
    pick(raw, ["AuthorisationStatus", "authorisationStatus", "IsAuthorised", "isAuthorised"]),
  );
  const authorisationDate = pick(raw, ["AuthorisationDate", "authorisationDate"]);
  const authorisationStatusDate = pick(raw, ["AuthorisationStatusDate", "authorisationStatusDate"]);
  const freelanceBasis = pick(raw, ["FreelanceBasis", "freelanceBasis", "Freelance", "freelance"]);
  const regulator = asString(pick(raw, ["Regulator", "regulator"]));
  const companyRegNo = asString(
    pick(raw, ["CompanyRegNo", "companyRegNo", "CompanyRegistrationNumber", "companyRegistrationNumber"]),
  );
  const noOfOffices = pick(raw, ["NoOfOffices", "noOfOffices", "NumberOfOffices", "numberOfOffices"]);

  const tradingNames = stringListFromApi(
    raw.TradingNames ?? raw.tradingNames ?? raw.TradingName ?? raw.tradingName,
  );
  const previousNames = stringListFromApi(raw.PreviousNames ?? raw.previousNames);
  const areasOfLaw = collectSraWorkAreaLabels(raw);
  const reservedActivities = stringListFromApi(
    raw.ReservedActivites ?? raw.ReservedActivities ?? raw.reservedActivities ?? raw.reservedActivites,
  );

  const orgWebsites = stringListFromApi(raw.Websites ?? raw.websites ?? raw.Website ?? raw.website);
  const orgEmails: string[] = [];
  const orgPhones: string[] = [];

  for (const o of officesList) {
    if (!o || typeof o !== "object") continue;
    const office = o as Record<string, unknown>;
    const email = asString(pick(office, ["Email", "email", "BusinessEmail", "businessEmail"]));
    const phone = asString(
      pick(office, ["PhoneNumber", "phoneNumber", "Telephone", "telephone", "Phone", "phone"]),
    );
    if (email && !orgEmails.includes(email)) orgEmails.push(email);
    if (phone && !orgPhones.includes(phone)) orgPhones.push(phone);
  }

  const officeWebsiteSet = new Set<string>();
  for (const o of officesList) {
    if (!o || typeof o !== "object") continue;
    const w = asString(
      pick(o as Record<string, unknown>, ["Website", "website", "WebsiteAddress", "websiteAddress"]),
    );
    if (w) officeWebsiteSet.add(w.startsWith("http") ? w : `https://${w.replace(/^\/\//, "")}`);
  }
  const websites = [
    ...new Set([
      ...orgWebsites.map((w) => (w.startsWith("http") ? w : `https://${w.replace(/^\/\//, "")}`)),
      ...officeWebsiteSet,
    ]),
  ];

  const authorised =
    authorisationStatus.toUpperCase() === "YES"
      ? "Yes"
      : authorisationStatus.toUpperCase() === "NO"
        ? "No"
        : authorisationStatus || "—";

  const orgLines = [
    bullet("SRA number (organisation)", firmSraNumber),
    bullet("Practice / organisation name", practiceName),
    bullet(
      "Current licence",
      authorisationType
        ? `${labelFrom(AUTHORISATION_TYPE_LABELS, authorisationType)} (${authorisationType})`
        : "—",
    ),
    bullet("Business type", humanizeType(businessType)),
    bullet("Organisation type", organisationType || "—"),
    bullet(
      "Constitution type",
      constitution ? `${labelFrom(CONSTITUTION_LABELS, constitution)} (${constitution})` : "—",
    ),
    bullet("Are they authorised", authorised),
    bullet("Authorisation date", formatDate(authorisationDate)),
    bullet("Authorisation status date", formatDate(authorisationStatusDate)),
    bullet("Whether they are freelance", yesNoUnknown(freelanceBasis)),
    bullet("Regulator", regulator || "—"),
    bulletList("Trading names", tradingNames),
    bulletList("Previous names", previousNames),
    bulletList("Areas of law they practise", areasOfLaw),
    bulletList("Reserved activities they can carry out", reservedActivities),
    bullet("Company registration number", companyRegNo),
    bullet("Number of offices", asString(noOfOffices) || String(officesList.length)),
    bulletList("Business email address(es)", orgEmails),
    bulletList("Telephone number(s)", orgPhones),
    bulletList("Website address(es)", websites),
  ];

  const officeSections: string[] = [];
  for (const [index, o] of officesList.entries()) {
    if (!o || typeof o !== "object") continue;
    const office = o as Record<string, unknown>;
    const officeId = asString(office.OfficeId ?? office.officeId ?? office.Id ?? office.id);
    const officeName = asString(office.Name ?? office.name ?? office.OfficeName ?? office.officeName);
    const officeTypeCode = asString(office.OfficeType ?? office.officeType);
    const officeType = labelFrom(OFFICE_TYPE_LABELS, officeTypeCode);
    const phone = asString(
      pick(office, ["PhoneNumber", "phoneNumber", "Telephone", "telephone", "Phone", "phone"]),
    );
    const email = asString(pick(office, ["Email", "email", "BusinessEmail", "businessEmail"]));
    const websiteRaw = asString(pick(office, ["Website", "website", "WebsiteAddress", "websiteAddress"]));
    const website = websiteRaw
      ? websiteRaw.startsWith("http")
        ? websiteRaw
        : `https://${websiteRaw.replace(/^\/\//, "")}`
      : "—";

    officeSections.push(
      [
        `### Office ${index + 1} — ${officeType}${officeName ? `: ${officeName}` : ""}`,
        "",
        bullet("SRA number (office)", officeId || "—"),
        bullet("Office name", officeName),
        bullet("Office type", officeTypeCode ? `${officeType} (${officeTypeCode})` : officeType),
        bullet("Practising address", officePractisingAddress(office)),
        bullet("Postal address", officePostalAddress(office)),
        bullet("Business email address", email),
        bullet("Telephone number", phone),
        bullet("Website address", website),
      ].join("\n"),
    );
  }

  if (!officeSections.length) {
    for (const [index, office] of normaliseSraOffices(officesList).entries()) {
      officeSections.push(
        [
          `### Office ${index + 1} — ${labelFrom(OFFICE_TYPE_LABELS, office.officeType)}${office.name ? `: ${office.name}` : ""}`,
          "",
          bullet("SRA number (office)", office.officeId || "—"),
          bullet("Office name", office.name),
          bullet("Office type", labelFrom(OFFICE_TYPE_LABELS, office.officeType)),
          bullet(
            "Practising address",
            formatAddressLines([
              office.address1,
              office.address2,
              office.address3,
              office.address4,
              office.town,
              office.county,
              office.postcode,
              office.country,
            ]),
          ),
          bullet("Postal address", "Not separately listed in SRA API (practising address used)"),
          bullet("Business email address", office.email),
          bullet("Telephone number", office.phoneNumber),
          bullet("Website address", office.website),
        ].join("\n"),
      );
    }
  }

  return `---
sraId: ${JSON.stringify(firmSraNumber)}
businessName: ${JSON.stringify(record.businessName)}
type: sra-raw
source: sra-api
importedAt: ${JSON.stringify(importedAt)}
wikiCard: ${JSON.stringify(`[[Wiki/Firms/${title}]]`)}
---

# ${practiceName}

Structured register extract from the SRA Data Share API. Normalised card: [[Wiki/Firms/${title}]].

## Organisation

${orgLines.join("\n")}

## Offices

${officeSections.length ? officeSections.join("\n\n") : "_No offices listed in API payload._"}

---

<details>
<summary>Full raw API JSON</summary>

\`\`\`json
${JSON.stringify(raw, null, 2)}
\`\`\`

</details>
`;
}
