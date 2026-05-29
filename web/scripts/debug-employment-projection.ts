/**
 * Debug employment SRA practice-area projection end-to-end.
 * Usage: npm run debug:employment-projection
 */
import "./load-dotenv";
import { prisma } from "../lib/db/prisma";
import { buildTypesenseListingsClientFromEnv } from "../lib/search/typesense-listings-client";
import { LEGAL_ENTITIES_COLLECTION } from "../lib/search-index/config";
import {
  buildSraDocuments,
  documentToTypesenseRecord,
} from "../lib/search-index/build-legal-entity-doc";
import {
  applyProviderIntelligenceSync,
  clearEnrichmentCache,
} from "../lib/search-index/apply-provider-intelligence";
import {
  projectSraPracticeAreas,
  projectAndApplySraPracticeAreas,
} from "../lib/sra/practice-area-projection";

const PHRASE_QUERIES = [
  "employment law",
  "unfair dismissal",
  "redundancy",
  "employment tribunal",
  "workplace discrimination",
  "constructive dismissal",
  "TUPE",
] as const;

const PG_PHRASE_FILTERS: { phrase: string; sql: string }[] = [
  { phrase: "employment", sql: `search_text ILIKE '%employment%'` },
  { phrase: "unfair dismissal", sql: `search_text ILIKE '%unfair dismissal%'` },
  { phrase: "redundancy", sql: `search_text ILIKE '%redundancy%'` },
  { phrase: "employment tribunal", sql: `search_text ILIKE '%employment tribunal%'` },
  { phrase: "workplace discrimination", sql: `search_text ILIKE '%workplace discrimination%'` },
  { phrase: "constructive dismissal", sql: `search_text ILIKE '%constructive dismissal%'` },
  { phrase: "TUPE", sql: `search_text ILIKE '%TUPE%'` },
];

async function pgPhraseCounts(): Promise<void> {
  console.info("\n=== Postgres SRA search_text phrase counts ===");
  for (const { phrase, sql } of PG_PHRASE_FILTERS) {
    const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM sra_organisations WHERE ${sql}`,
    );
    console.info(`  ${phrase}: ${rows[0]?.count ?? 0}`);
  }
}

async function projectionOnPgMatches(limit = 5000): Promise<{
  scanned: number;
  employmentPrimary: number;
  employmentScoredNotPrimary: number;
  samples: Array<{
    sraId: string;
    title: string;
    slugs: string[];
    signals: string[];
    confidence: number;
    empConf?: number;
  }>;
}> {
  const rows = await prisma.sraOrganisation.findMany({
    where: {
      OR: PG_PHRASE_FILTERS.map((f) => ({
        searchText: { contains: f.phrase, mode: "insensitive" as const },
      })),
    },
    take: limit,
    select: { sraId: true, businessName: true, searchText: true },
  });

  let employmentPrimary = 0;
  let employmentScoredNotPrimary = 0;
  const samples: Array<{
    sraId: string;
    title: string;
    slugs: string[];
    signals: string[];
    confidence: number;
    empConf?: number;
  }> = [];

  for (const org of rows) {
    const p = projectSraPracticeAreas({
      organisationName: org.businessName,
      descriptionText: org.searchText,
    });
    const empSignals = p.matchedSignals.filter((s) => s.startsWith("employment:"));
    if (empSignals.length > 0 && !p.practiceAreaSlugs.includes("employment")) {
      employmentScoredNotPrimary++;
    }
    if (p.practiceAreaSlugs.includes("employment")) {
      employmentPrimary++;
      if (samples.length < 20) {
        samples.push({
          sraId: org.sraId,
          title: org.businessName,
          slugs: p.practiceAreaSlugs,
          signals: empSignals.slice(0, 4),
          confidence: p.confidence,
          empConf: p.employmentProjectionConfidence,
        });
      }
    }
  }

  return { scanned: rows.length, employmentPrimary, employmentScoredNotPrimary, samples };
}

async function pipelineSample(sraId: string): Promise<void> {
  const docs = await buildSraDocuments({ take: 50000, skipGeo: true });
  const doc = docs.find((d) => d.sraId === sraId || d.id === `sra:${sraId}`);
  if (!doc) {
    console.info(`  pipeline: no built doc for sraId=${sraId}`);
    return;
  }
  const afterIntel = applyProviderIntelligenceSync(doc, []);
  const ts = documentToTypesenseRecord(afterIntel);
  console.info(`  pipeline sraId=${sraId}`);
  console.info(`    after build: slugs=${JSON.stringify(doc.practiceAreaSlugs)}`);
  console.info(`    after intelligence: slugs=${JSON.stringify(afterIntel.practiceAreaSlugs)}`);
  console.info(`    typesense record slugs=${JSON.stringify(ts.practiceAreaSlugs)}`);
}

async function typesensePhraseProbe(): Promise<void> {
  const client = buildTypesenseListingsClientFromEnv();
  if (!client) {
    console.info("\n=== Typesense: skipped (no client) ===");
    return;
  }

  console.info("\n=== Typesense employment slug count ===");
  const countRes = await client
    .collections(LEGAL_ENTITIES_COLLECTION)
    .documents()
    .search({
      q: "*",
      query_by: "title",
      filter_by: "entityType:=`sra_organisation` && practiceAreaSlugs:=[`employment`]",
      per_page: 0,
    });
  console.info(`  employment SRA docs: ${(countRes as { found?: number }).found ?? 0}`);

  console.info("\n=== Typesense searchText phrase hits (SRA orgs) ===");
  for (const phrase of PHRASE_QUERIES) {
    try {
      const res = await client
        .collections(LEGAL_ENTITIES_COLLECTION)
        .documents()
        .search({
          q: phrase,
          query_by: "searchText,expandedSearchText,description",
          filter_by: "entityType:=`sra_organisation`",
          per_page: 3,
        });
      const hits = (res as { hits?: { document?: Record<string, unknown> }[] }).hits ?? [];
      const lines = hits.map((h) => {
        const d = h.document ?? {};
        const slugs = Array.isArray(d.practiceAreaSlugs) ? (d.practiceAreaSlugs as string[]).join(",") : "[]";
        return `    ${String(d.id)} | slugs=[${slugs}] | ${String(d.title ?? "").slice(0, 50)}`;
      });
      console.info(`  "${phrase}": found=${(res as { found?: number }).found ?? 0}`);
      for (const line of lines) console.info(line);
    } catch (e) {
      console.info(`  "${phrase}": error ${String(e)}`);
    }
  }

  console.info("\n=== Typesense sample with practiceAreaSlugs (any) ===");
  const sampleRes = await client
    .collections(LEGAL_ENTITIES_COLLECTION)
    .documents()
    .search({
      q: "*",
      query_by: "title",
      filter_by: "entityType:=`sra_organisation`",
      per_page: 5,
    });
  for (const h of (sampleRes as { hits?: { document?: Record<string, unknown> }[] }).hits ?? []) {
    const d = h.document ?? {};
    console.info(
      `    ${d.id} slugs=${JSON.stringify(d.practiceAreaSlugs)} taxonomy=${JSON.stringify((d.taxonomyProjectionMatches as string[])?.slice(0, 3))}`,
    );
  }
}

async function main(): Promise<void> {
  clearEnrichmentCache();
  await pgPhraseCounts();

  const proj = await projectionOnPgMatches();
  console.info("\n=== Direct projection on PG phrase-matching orgs ===");
  console.info(
    JSON.stringify(
      {
        scanned: proj.scanned,
        employmentPrimary: proj.employmentPrimary,
        employmentScoredNotPrimary: proj.employmentScoredNotPrimary,
      },
      null,
      2,
    ),
  );
  console.info("First employment primary matches:");
  for (const s of proj.samples) {
    console.info(
      `  ${s.sraId} | ${s.title.slice(0, 45)} | slugs=${s.slugs.join(",")} | empConf=${s.empConf ?? "n/a"} | ${s.signals.join("; ")}`,
    );
  }

  if (proj.samples[0]) {
    console.info("\n=== Pipeline trace for first employment match ===");
    await pipelineSample(proj.samples[0].sraId);
  } else {
    const any = await prisma.sraOrganisation.findFirst({
      where: { searchText: { contains: "employment", mode: "insensitive" } },
      select: { sraId: true, businessName: true, searchText: true },
    });
    if (any) {
      console.info("\n=== No primary employment; testing first PG 'employment' row ===");
      const p = projectSraPracticeAreas({
        organisationName: any.businessName,
        descriptionText: any.searchText,
      });
      console.info(`  ${any.sraId} slugs=${p.practiceAreaSlugs.join(",")} signals=${p.matchedSignals.slice(0, 6).join("; ")}`);
      const doc = projectAndApplySraPracticeAreas({
        id: `sra:${any.sraId}`,
        entityType: "sra_organisation",
        title: any.businessName,
        description: any.searchText.slice(0, 400),
        practiceAreas: [],
        categories: ["SRA organisation"],
        subIssues: [],
        searchText: any.searchText,
        expandedSearchText: any.searchText,
        source: "sra",
        legalAid: false,
        authorityScore: 0.78,
        profileCompletenessScore: 0.5,
        rawSourceId: any.sraId,
        updatedAt: Date.now(),
      });
      console.info(`  apply slugs=${doc.practiceAreaSlugs?.join(",")}`);
      await pipelineSample(any.sraId);
    }
  }

  await typesensePhraseProbe();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
