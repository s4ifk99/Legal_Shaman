/**
 * Optional sections that blog drafts carry into the wiki markdown and that the
 * public article renders from `page.content` (the index keeps full content, so
 * these survive a re-index without schema changes).
 */
export type WikiExtraSection = { intro: string[]; bullets: string[] };

export type WikiExtraSections = {
  law: WikiExtraSection | null;
  howWeHelp: WikiExtraSection | null;
  nextStep: WikiExtraSection | null;
  disclaimer: string | null;
};

export const WIKI_EXTRA_HEADINGS = {
  law: "What the law says in England and Wales",
  howWeHelp: "How Legal Shaman helps",
  nextStep: "Next step",
  disclaimer: "Disclaimer",
} as const;

function sectionBody(content: string, heading: string): string | null {
  const chunks = content.split(/^##\s+/m);
  for (const part of chunks.slice(1)) {
    const nl = part.indexOf("\n");
    const head = (nl === -1 ? part : part.slice(0, nl)).trim();
    if (head.toLowerCase() === heading.toLowerCase()) {
      return nl === -1 ? "" : part.slice(nl + 1).trim();
    }
  }
  return null;
}

function toSection(body: string | null): WikiExtraSection | null {
  if (!body) return null;
  const intro: string[] = [];
  const bullets: string[] = [];
  for (const raw of body.split(/\n{2,}/)) {
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (/^[-*]\s+/.test(line)) bullets.push(line.replace(/^[-*]\s+/, ""));
    }
    const prose = lines.filter((l) => !/^[-*]\s+/.test(l)).join(" ");
    if (prose) intro.push(prose);
  }
  if (!intro.length && !bullets.length) return null;
  return { intro, bullets };
}

export function extractWikiExtraSections(content: string | undefined | null): WikiExtraSections {
  const md = content ?? "";
  const disclaimer = sectionBody(md, WIKI_EXTRA_HEADINGS.disclaimer);
  return {
    law: toSection(sectionBody(md, WIKI_EXTRA_HEADINGS.law)),
    howWeHelp: toSection(sectionBody(md, WIKI_EXTRA_HEADINGS.howWeHelp)),
    nextStep: toSection(sectionBody(md, WIKI_EXTRA_HEADINGS.nextStep)),
    disclaimer: disclaimer ? disclaimer.replace(/\s+/g, " ").trim() : null,
  };
}
