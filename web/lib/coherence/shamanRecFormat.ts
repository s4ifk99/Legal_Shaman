/**
 * Shaman Recommends section format — What the sources say / Practical route /
 * optional related title / Limits. Used by Overview UI and deterministic builders.
 */

export function hasShamanCoreSections(text: string): boolean {
  return (
    /what the sources say/i.test(text) &&
    /practical route/i.test(text) &&
    /limits\s*\/\s*missing facts/i.test(text)
  );
}

export function shamanFormatAnswer(parts: {
  sourcesSay: string;
  practical: string[];
  limits: string;
  relatedTitle?: string;
  relatedBody?: string;
}): string {
  const practical = parts.practical
    .map((s) => s.replace(/^\s*[•\-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean);
  const blocks = [
    `What the sources say\n${parts.sourcesSay.trim()}`,
    practical.length
      ? `Practical route\n${practical.map((s) => `• ${s}`).join("\n")}`
      : "",
  ];
  if (parts.relatedTitle?.trim() && parts.relatedBody?.trim()) {
    blocks.push(`${parts.relatedTitle.trim()}\n${parts.relatedBody.trim()}`);
  }
  blocks.push(`Limits / missing facts\n${parts.limits.trim()}`);
  return blocks.filter(Boolean).join("\n\n");
}

function stripMdNoise(text: string): string {
  return String(text || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .trim();
}

/** Turn freeform / case-shaped overviews into Shaman Recommends section cards. */
export function ensureShamanRecAnswer(opts: {
  answer: string;
  recommendations?: string[];
  missingFacts?: string[];
  relatedTitle?: string;
  relatedBody?: string;
}): string {
  const raw = String(opts.answer || "").trim();
  if (!raw) return raw;

  if (hasShamanCoreSections(raw)) {
    return raw;
  }

  const lines = raw.split(/\n/).map((l) => l.trimEnd());
  const numbered: string[] = [];
  const proseLines: string[] = [];
  let inNumbers = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (!inNumbers) proseLines.push("");
      continue;
    }
    const num = trimmed.match(/^\d+\.\s+(.+)$/);
    const bullet = trimmed.match(/^[•\-*]\s+(.+)$/);
    if (num) {
      inNumbers = true;
      numbered.push(stripMdNoise(num[1]!));
      continue;
    }
    if (bullet && (inNumbers || numbered.length)) {
      numbered.push(stripMdNoise(bullet[1]!));
      continue;
    }
    if (
      /^(the matter|area of law|what is live now vs later|next steps|sources used from the library|supplemental)/i.test(
        trimmed,
      )
    ) {
      continue;
    }
    if (/^this client was recommended by legalshaman/i.test(trimmed)) continue;
    proseLines.push(trimmed);
  }

  const prose = proseLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const fromRecs = (opts.recommendations || [])
    .map((r) => stripMdNoise(r))
    .filter((r) => r.length >= 8);

  const practical = (numbered.length ? numbered : fromRecs).slice(0, 6);

  let sourcesSay = prose
    .replace(/\n?\d+\.\s+[^\n]+/g, "")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
  if (!sourcesSay || sourcesSay.length < 40) {
    sourcesSay =
      prose.slice(0, 600) ||
      "Matched guidance and Third Eye research are summarised below. Check the cited sources before you act.";
  }
  const paras = sourcesSay.split(/\n{2,}/).filter(Boolean);
  sourcesSay = paras.slice(0, 2).join("\n\n");

  const limitsBits = [
    ...(opts.missingFacts || []).slice(0, 3),
    "This is general signposting from LegalShaman.com — not legal advice. For personalised help, contact Citizens Advice or use Find a Lawyer. Firms with indexed commentary below are signposts, not endorsements.",
  ];

  return shamanFormatAnswer({
    sourcesSay,
    practical: practical.length
      ? practical
      : [
          "Gather contracts, notices, dated messages, and the outcome you want.",
          "Check the cited free-help and wiki sources before writing to the other side.",
          "Ask Citizens Advice or a solicitor who does this kind of work if wording is uncertain.",
        ],
    relatedTitle: opts.relatedTitle,
    relatedBody: opts.relatedBody,
    limits: limitsBits.filter(Boolean).join(" "),
  });
}
