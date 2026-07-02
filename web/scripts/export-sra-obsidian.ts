/**
 * Export all SRA organisations to an Obsidian vault:
 *   Raw/              — structured register extract per firm
 *   Wiki/Firms/       — firm cards
 *   Wiki/Locations/   — firms grouped by Raw office location
 *   Wiki/Business Types/ — firms grouped by Raw business type
 *
 * Run: cd web && npm run sra:obsidian
 */
import "./load-dotenv";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchAllOrganisationsFromApi } from "@/lib/sra/sra-fetch";
import {
  collectSraWorkAreaLabels,
  normaliseSraOrganisationV2,
  type SraV2Record,
} from "@/lib/search/sra-document";
import {
  buildStructuredSraRawMarkdown,
  extractBusinessTypeLabel,
  extractCurrentLicenceLabel,
  extractRawLocations,
} from "@/lib/sra/sra-obsidian-raw-format";

const DEFAULT_OUT =
  process.env.SRA_OBSIDIAN_OUT?.trim() ||
  join(process.cwd(), "..", "..", "SRA_Index");

function parseArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function parseLimit(): number | undefined {
  const raw = parseArg("limit");
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}

function safeFileStem(name: string, max = 80): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return cleaned || "Unnamed";
}

function firmNoteTitle(record: SraV2Record): string {
  return `${record.sraId} - ${safeFileStem(record.displayName || record.businessName)}`;
}

/** Obsidian vault root is SRA_Index — wiki notes live under Wiki/, raw under Raw/ */
const W = "Wiki";
const linkLocation = (label: string) => `[[${W}/Locations/${safeFileStem(label)}|${label}]]`;
const linkBusinessType = (label: string) =>
  `[[${W}/Business Types/${safeFileStem(label)}|${label}]]`;
const linkFirm = (title: string) => `[[${W}/Firms/${title}|${title}]]`;
const linkRaw = (sraId: string) => `[[Raw/${sraId}]]`;

function yamlScalar(value: string): string {
  if (!value) return '""';
  if (/[:#\n"'&*]|^\s|\s$/.test(value)) return JSON.stringify(value);
  return value;
}

function yamlList(values: string[]): string {
  if (values.length === 0) return "  []";
  return values.map((v) => `  - ${yamlScalar(v)}`).join("\n");
}

function formatOffices(offices: SraV2Record["offices"]): string {
  if (!offices.length) return "_No office rows in import._\n";
  return offices
    .map((o, i) => {
      const lines = [
        `### Office ${i + 1}${o.officeType ? ` (${o.officeType})` : ""}`,
        o.name ? `- **Name:** ${o.name}` : null,
        o.address1
          ? `- **Address:** ${[o.address1, o.address2, o.address3, o.address4].filter(Boolean).join(", ")}`
          : null,
        o.town ? `- **Town:** ${o.town}` : null,
        o.county ? `- **County:** ${o.county}` : null,
        o.postcode ? `- **Postcode:** ${o.postcode}` : null,
        o.country ? `- **Country:** ${o.country}` : null,
        o.phoneNumber ? `- **Phone:** ${o.phoneNumber}` : null,
        o.email ? `- **Email:** ${o.email}` : null,
        o.website ? `- **Website:** ${o.website}` : null,
      ].filter(Boolean);
      return lines.join("\n");
    })
    .join("\n\n");
}

function buildWikiCard(
  record: SraV2Record,
  title: string,
  businessType: string,
  locations: string[],
): string {
  const areasOfLaw = collectSraWorkAreaLabels(record.rawPayload);
  const businessTypeLink = linkBusinessType(businessType);
  const locationLinks = locations.map((l) => linkLocation(l)).join(", ");
  const licence = extractCurrentLicenceLabel(record);

  return `---
sraId: ${yamlScalar(record.sraId)}
type: sra-firm
businessName: ${yamlScalar(record.businessName)}
displayName: ${yamlScalar(record.displayName)}
businessType: ${yamlScalar(businessType)}
currentLicence: ${yamlScalar(licence)}
authorisationStatus: ${yamlScalar(record.authorisationStatus ?? "")}
phone: ${yamlScalar(record.phone)}
email: ${yamlScalar(record.email ?? "")}
website: ${yamlScalar(record.website ?? "")}
city: ${yamlScalar(record.city)}
postcode: ${yamlScalar(record.postcode)}
county: ${yamlScalar(record.county)}
country: ${yamlScalar(record.country)}
sraProfileUrl: ${yamlScalar(record.sraProfileUrl)}
locations:
${yamlList(locations)}
areasOfLaw:
${yamlList(areasOfLaw)}
tradingNames:
${yamlList(record.tradingNames)}
previousNames:
${yamlList(record.previousNames)}
tags:
  - sra/firm
  - business-type/${slug(businessType)}
${locations.map((l) => `  - location/${slug(l)}`).join("\n")}
rawNote: ${JSON.stringify(`Raw/${record.sraId}`)}
---

# ${record.displayName || record.businessName}

> [!abstract] Firm card
> SRA **${record.sraId}** · ${businessTypeLink} · ${locationLinks}

| Field | Value |
| --- | --- |
| SRA number | [${record.sraId}](${record.sraProfileUrl}) |
| Business type | ${businessTypeLink} |
| Current licence | ${licence} |
| Business name | ${record.businessName || "—"} |
| Authorisation | ${record.authorisationStatus || "—"} |
| Phone | ${record.phone || "—"} |
| Email | ${record.email || "—"} |
| Website | ${record.website ? `[${record.website}](${record.website})` : "—"} |
| Primary city | ${record.city || "—"} |
| Postcode | ${record.postcode || "—"} |
| County | ${record.county || "—"} |
| Country | ${record.country || "—"} |

## Business type

- ${businessTypeLink}
- Raw register note: ${linkRaw(record.sraId)}

## Locations

${locations.map((l) => `- ${linkLocation(l)}`).join("\n")}

## Areas of law

${areasOfLaw.length ? areasOfLaw.map((a) => `- ${a}`).join("\n") : "_Not listed in SRA API._"}

## Trading names

${record.tradingNames.length ? record.tradingNames.map((n) => `- ${n}`).join("\n") : "_None listed._"}

## Previous names

${record.previousNames.length ? record.previousNames.map((n) => `- ${n}`).join("\n") : "_None listed._"}

## Offices

${formatOffices(record.offices)}

## Raw import

Structured extract: ${linkRaw(record.sraId)}
`;
}

type WikiIndexKind = "location" | "business-type";

function buildIndexPage(
  label: string,
  kind: WikiIndexKind,
  firms: { title: string; sraId: string }[],
): string {
  const sorted = [...firms].sort((a, b) => a.title.localeCompare(b.title, "en-GB"));
  const kindLabel = kind === "location" ? "Location" : "Business type";
  return `---
type: sra-index
indexKind: ${kind}
label: ${yamlScalar(label)}
firmCount: ${sorted.length}
tags:
  - sra/index
  - sra/${kind}/${slug(label)}
---

# ${label}

> [!info] ${kindLabel} index
> **${sorted.length}** firms (from Raw SRA register data)

## Firms

${sorted.map((f) => `- ${linkFirm(f.title)} · Raw: ${linkRaw(f.sraId)}`).join("\n")}
`;
}

function buildDirectoryPage(
  title: string,
  entries: Map<string, { title: string; sraId: string }[]>,
): string {
  return `---
type: sra-index-directory
---

# ${title}

${[...entries.keys()]
  .sort((a, b) => a.localeCompare(b, "en-GB"))
  .map((k) => `- [[${safeFileStem(k)}|${k}]] (${entries.get(k)?.length ?? 0})`)
  .join("\n")}
`;
}

async function writeMany(
  jobs: { path: string; content: string }[],
  concurrency = 64,
): Promise<void> {
  let i = 0;
  async function worker() {
    while (i < jobs.length) {
      const idx = i++;
      const job = jobs[idx];
      await writeFile(job.path, job.content, "utf8");
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

async function main() {
  const outRoot = parseArg("out") || DEFAULT_OUT;
  const limit = parseLimit();
  const key = process.env.SRA_APIM_SUBSCRIPTION_KEY?.trim();
  if (!key) {
    console.error("Missing SRA_APIM_SUBSCRIPTION_KEY in web/.env.local");
    process.exit(1);
  }

  const rawDir = join(outRoot, "Raw");
  const wikiDir = join(outRoot, "Wiki");
  const firmsDir = join(wikiDir, "Firms");
  const locationsDir = join(wikiDir, "Locations");
  const businessTypesDir = join(wikiDir, "Business Types");

  for (const dir of [rawDir, firmsDir, locationsDir, businessTypesDir]) {
    await mkdir(dir, { recursive: true });
  }
  await rm(join(wikiDir, "Practice Areas"), { recursive: true, force: true });
  for (const stale of ["Locations", "Business Types", "Firms"]) {
    await rm(join(outRoot, stale), { recursive: true, force: true });
  }

  console.log("Fetching SRA GetAll…");
  let rows = await fetchAllOrganisationsFromApi(key);
  console.log("Fetched rows:", rows.length);
  if (limit) {
    rows = rows.slice(0, limit);
    console.log("Limited to:", rows.length);
  }

  const records: SraV2Record[] = [];
  let skipped = 0;
  for (const raw of rows) {
    const record = normaliseSraOrganisationV2(raw);
    if (!record) {
      skipped++;
      continue;
    }
    records.push(record);
  }

  console.log("Normalised firms:", records.length, "skipped:", skipped);

  const importedAt = new Date().toISOString();
  const jobs: { path: string; content: string }[] = [];
  const locationMap = new Map<string, { title: string; sraId: string }[]>();
  const businessTypeMap = new Map<string, { title: string; sraId: string }[]>();

  for (const record of records) {
    const title = firmNoteTitle(record);
    const businessType = extractBusinessTypeLabel(record);
    const locations = extractRawLocations(record);
    const firmRef = { title, sraId: record.sraId };

    const btList = businessTypeMap.get(businessType) ?? [];
    btList.push(firmRef);
    businessTypeMap.set(businessType, btList);

    for (const loc of locations) {
      const list = locationMap.get(loc) ?? [];
      list.push(firmRef);
      locationMap.set(loc, list);
    }

    jobs.push({
      path: join(rawDir, `${record.sraId}.md`),
      content: buildStructuredSraRawMarkdown(record, title, importedAt),
    });
    jobs.push({
      path: join(firmsDir, `${title}.md`),
      content: buildWikiCard(record, title, businessType, locations),
    });
  }

  for (const [label, firms] of locationMap) {
    jobs.push({
      path: join(locationsDir, `${safeFileStem(label)}.md`),
      content: buildIndexPage(label, "location", firms),
    });
  }

  for (const [label, firms] of businessTypeMap) {
    jobs.push({
      path: join(businessTypesDir, `${safeFileStem(label)}.md`),
      content: buildIndexPage(label, "business-type", firms),
    });
  }

  jobs.push({
    path: join(wikiDir, "SRA Index Home.md"),
    content: `---
type: sra-vault-home
firmCount: ${records.length}
locationCount: ${locationMap.size}
businessTypeCount: ${businessTypeMap.size}
importedAt: ${yamlScalar(importedAt)}
---

# SRA Index

Visual map of the UK SRA register — grouped in Wiki by **location** and **business type** from Raw API data.

| Section | Notes |
| --- | --- |
| [[${W}/Locations/_Locations Index\\|Locations]] | ${locationMap.size} location indexes |
| [[${W}/Business Types/_Business Types Index\\|Business types]] | ${businessTypeMap.size} business-type indexes |
| \`Raw/\` | ${records.length} structured register notes |
| \`Wiki/Firms/\` | ${records.length} firm cards |

## Quick stats

- **Firms:** ${records.length}
- **Location groups:** ${locationMap.size}
- **Business type groups:** ${businessTypeMap.size}
- **Imported:** ${importedAt}

Browse [[${W}/Locations/_Locations Index]] or [[${W}/Business Types/_Business Types Index]], or open any firm card and follow links back to Raw notes.
`,
  });

  jobs.push({
    path: join(locationsDir, "_Locations Index.md"),
    content: buildDirectoryPage("Locations", locationMap),
  });

  jobs.push({
    path: join(businessTypesDir, "_Business Types Index.md"),
    content: buildDirectoryPage("Business types", businessTypeMap),
  });

  console.log("Writing", jobs.length, "notes to", outRoot);
  console.log(
    "Wiki groups:",
    locationMap.size,
    "locations,",
    businessTypeMap.size,
    "business types",
  );
  await writeMany(jobs);
  console.log("Done.");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
