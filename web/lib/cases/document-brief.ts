/**
 * Structured extract from an uploaded letter / photo / PDF (PCN, court letter, etc.).
 * Signposting aid only — not a legal determination.
 */

export type DocumentBrief = {
  docType: string;
  issuer: string | null;
  title: string | null;
  summary: string;
  keyFacts: string[];
  amounts: string[];
  dates: string[];
  deadlines: string[];
  references: string[];
  keyQuotes: string[];
  suggestedMatter: string | null;
  confidence: "high" | "medium" | "low";
  missingFacts: string[];
  rightsFraming: string;
  nextStepHints: string[];
};

export function emptyDocumentBrief(fallback: string): DocumentBrief {
  return {
    docType: "unknown",
    issuer: null,
    title: null,
    summary: fallback,
    keyFacts: [],
    amounts: [],
    dates: [],
    deadlines: [],
    references: [],
    keyQuotes: [],
    suggestedMatter: null,
    confidence: "low",
    missingFacts: ["Could not read enough text from this file."],
    rightsFraming:
      "I could not reliably read this document. Tell me in your own words what it is and what it asks you to do.",
    nextStepHints: ["Describe the letter or photo in a short sentence so we can map next steps."],
  };
}

/** Plain-language shaman reply after a successful (or partial) extract. */
export function formatDocumentBriefForChat(brief: DocumentBrief, fileName: string): string {
  const lines: string[] = [];
  lines.push(`I’ve looked at “${fileName}”.`);

  const what =
    brief.title?.trim() ||
    (brief.docType && brief.docType !== "unknown" ? brief.docType : null) ||
    "a document";
  const issuerBit = brief.issuer ? ` from ${brief.issuer}` : "";
  lines.push(`It looks like ${what}${issuerBit}.`);

  if (brief.summary.trim()) {
    lines.push(brief.summary.trim());
  }

  if (brief.keyFacts.length) {
    lines.push(`Key points I can see:\n${brief.keyFacts.map((f) => `• ${f}`).join("\n")}`);
  }

  if (brief.deadlines.length) {
    lines.push(
      `Deadlines or time limits mentioned:\n${brief.deadlines.map((d) => `• ${d}`).join("\n")}`,
    );
  } else if (brief.dates.length) {
    lines.push(`Dates mentioned:\n${brief.dates.map((d) => `• ${d}`).join("\n")}`);
  }

  if (brief.amounts.length) {
    lines.push(`Amounts:\n${brief.amounts.map((a) => `• ${a}`).join("\n")}`);
  }

  if (brief.rightsFraming.trim()) {
    lines.push(brief.rightsFraming.trim());
  }

  if (brief.nextStepHints.length) {
    lines.push(
      `Practical next steps to consider (signposting only — not legal advice):\n${brief.nextStepHints
        .map((s) => `• ${s}`)
        .join("\n")}`,
    );
  }

  if (brief.confidence === "low" || brief.missingFacts.length) {
    const miss = brief.missingFacts.slice(0, 4);
    lines.push(
      miss.length
        ? `I’m less sure about some details. It would help if you tell me: ${miss.join("; ")}`
        : "If anything above looks wrong, correct me in your own words.",
    );
  } else {
    lines.push("If anything above looks wrong, correct me — then we can map who can help and what to do next.");
  }

  return lines.join("\n\n");
}

export function documentBriefToStorySeed(brief: DocumentBrief): string {
  const parts = [
    brief.summary,
    brief.suggestedMatter,
    brief.keyFacts.slice(0, 6).join(". "),
    brief.deadlines.length ? `Deadlines: ${brief.deadlines.join("; ")}` : "",
  ].filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 1200);
}
