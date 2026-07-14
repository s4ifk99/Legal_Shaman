/** Generate snippets to paste into search eval suites from production queries. */

export function formatDirectoryEvalCaseSnippet(opts: {
  id: string;
  query: string;
  expectedTaxonomySlug?: string;
  notes?: string;
}): string {
  const slug = opts.expectedTaxonomySlug ? `    expectedTaxonomySlug: "${opts.expectedTaxonomySlug}",\n` : "";
  const notes = opts.notes
    ? `    notes: ${JSON.stringify(opts.notes)},\n`
    : "";
  return `  D({
    id: ${JSON.stringify(opts.id)},
    query: ${JSON.stringify(opts.query)},
    channel: "directory",
${slug}    shouldClarify: false,
    mustReturnResults: true,
    minRelevantInTopK: 1,
    topK: 10,
${notes}  }),`;
}

export function formatTriageJourneyHint(opts: { title: string; firstQuery: string }): string {
  return `// Add to triage journey cases: { title: ${JSON.stringify(opts.title)}, firstQuery: ${JSON.stringify(opts.firstQuery)} }`;
}

export function formatLegalKnowledgeEvalCaseSnippet(opts: {
  id: string;
  query: string;
  expectTaxonomySlug?: string;
  expectSpecificIssue?: string;
  tiers?: string[];
  notes?: string;
}): string {
  const tiers =
    opts.tiers?.length
      ? `    tiers: ${JSON.stringify(opts.tiers)},\n`
      : `    tiers: ["unit", "retrieval", "integration"],\n`;
  const slug = opts.expectTaxonomySlug
    ? `    expectTaxonomySlug: ${JSON.stringify(opts.expectTaxonomySlug)},\n`
    : "";
  const sub = opts.expectSpecificIssue
    ? `    expectSpecificIssue: ${JSON.stringify(opts.expectSpecificIssue)},\n`
    : "";
  const notes = opts.notes ? `    notes: ${JSON.stringify(opts.notes)},\n` : "";
  return `  L({
    id: ${JSON.stringify(opts.id)},
    query: ${JSON.stringify(opts.query)},
${tiers}${slug}${sub}${notes}  }),`;
}
