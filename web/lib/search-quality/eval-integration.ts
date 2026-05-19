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
