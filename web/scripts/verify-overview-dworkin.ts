import { collectOverviewHits } from "../lib/coherence/overviewAnswer";
import { resolveTaxonomy } from "../lib/legal/taxonomy-resolver";
import { dworkinKindForWikiPage } from "../lib/wiki/dworkin-tags";
import { retrieveDworkinSnippetsForOverview } from "../lib/coherence/overviewDworkinPack";

const cases = [
  {
    name: "pcn",
    expectSlug: "parking_pcn",
    rejectTitle: /working (time|hours)|grievance|employment law/i,
    wantTitle: /parking ticket|pcn|penalty/i,
    text: `Someone at my work got 3 PCNs in Hounslow on a permit road. Can they appeal to London Tribunals? Night worker, day shifts.`,
  },
  {
    name: "van",
    expectSlug: "consumer_vehicle_repair",
    rejectTitle: /water supply|grievance|working time/i,
    wantTitle: /car repair|repairing a car|workmanship|poor service/i,
    text: `Garage charged £1800 to fix my works van and it's still broken. They used a used part. What are my rights?`,
  },
  {
    name: "flatmate",
    expectSlug: "housing",
    rejectTitle: /section 13|shared ownership|water supply|parking ticket/i,
    wantTitle: /share accommodation|renting with other|internet or tv/i,
    text: `Flatmate won't pay their share of the joint rent and changed the WiFi password. They put up a Ring camera in the hall and threatened me. Can I send a letter before action?`,
  },
  {
    name: "employment",
    expectSlug: "employment",
    rejectTitle: /parking ticket|car repair/i,
    wantTitle: /dismiss|grievance|acas|rights at work|employment/i,
    text: `I was sacked after raising a grievance about unpaid wages. Do I go to ACAS before an employment tribunal?`,
  },
];

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

for (const c of cases) {
  const tax = resolveTaxonomy({ story: c.text });
  const slug = tax?.taxonomySlug || null;
  if (slug !== c.expectSlug) {
    fail(`${c.name}: taxonomy ${slug} expected ${c.expectSlug}`);
  }

  const hits = collectOverviewHits(c.text);
  const titles = hits.map((h) => h.title);
  if (!titles.some((t) => c.wantTitle.test(t))) {
    fail(`${c.name}: no wanted wiki title in ${titles.join(" | ")}`);
  }
  const bad = titles.find((t) => c.rejectTitle.test(t));
  if (bad) fail(`${c.name}: off-topic wiki page "${bad}"`);

  const tagged = hits.map((h) => {
    const tag = dworkinKindForWikiPage(h);
    return `${h.title} [${h.dworkinKind || tag.kind}/${h.dworkinSource || tag.source}]`;
  });

  const dworkin = retrieveDworkinSnippetsForOverview({
    query: c.text,
    taxonomySlug: slug,
    excludeTitles: titles,
    limit: 4,
  });
  const dBad = dworkin.find((s) => c.rejectTitle.test(s.title));
  if (dBad) fail(`${c.name}: off-topic dworkin "${dBad.title}"`);

  console.log(`\n== ${c.name} slug=${slug} ==`);
  console.log("wiki:", tagged.join("\n      "));
  console.log(
    "dworkin:",
    dworkin.map((s) => `${s.title} [${s.dworkinKind}/${s.layer}]`).join("\n         ") || "(none)",
  );
}

const appeal = dworkinKindForWikiPage({ title: "Appealing a parking ticket" });
const concept = dworkinKindForWikiPage({ title: "Assured shorthold tenancy", category: "Concepts" });
if (appeal.kind !== "rule" || appeal.source !== "mapped") {
  fail(`Appealing a parking ticket should be mapped rule, got ${JSON.stringify(appeal)}`);
}
if (concept.kind !== "policy") {
  fail(`AST concept should be policy, got ${JSON.stringify(concept)}`);
}

console.log("\nPASS overview dworkin mapping + mixed pack");
