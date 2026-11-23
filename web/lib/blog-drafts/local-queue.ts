import fs from "node:fs";
import path from "node:path";

export type DraftDecision = "Ready for review" | "Approved" | "Kill" | "Published";

export type LocalDraftMeta = {
  file: string;
  title: string;
  demandRef: string;
  matter: string;
  why: string;
  matchFile?: string;
  matchOk?: boolean;
  matchQa?: "ok" | "weak" | "empty";
};

export type LocalDraftBatch = {
  date: string;
  status: string;
  source: string;
  note: string;
  drafts: LocalDraftMeta[];
};

export type LocalDraft = LocalDraftMeta & {
  status: DraftDecision;
  body: string;
};

export type { BlogFreeHelpMatch } from "./match-free";
export {
  readMatchSnapshot,
  matchSnapshotPath,
  anonymisedQueryFromDraft,
} from "./match-free";

export type PublishedRecord = {
  title: string;
  wikiId: string;
  liveUrl: string;
  file?: string;
};

const ROOT = path.join(process.cwd(), "data", "blog-drafts");

const MATTER_TO_DIR: Record<string, string> = {
  consumer: "Areas/Consumer Rights/Faulty Goods and Services",
  parking: "Areas/Driving and Parking/Parking and PCNs",
  employment: "Areas/Work and Employment/Your Rights at Work",
  housing: "Areas/Home and Housing/Renting",
  neighbours: "Areas/Neighbours and Property/Boundaries and Rights",
  crime: "Areas/Crime and Police/Victim Support",
  other: "Areas/Courts and Disputes/Starting a Claim",
};

function batchDir(date: string): string {
  return path.join(ROOT, date);
}

export function listLocalBatchDates(): string[] {
  if (!fs.existsSync(ROOT)) return [];
  return fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort()
    .reverse();
}

export function latestLocalBatchDate(): string | null {
  return listLocalBatchDates()[0] ?? null;
}

export function readBatch(date: string): LocalDraftBatch {
  const indexPath = path.join(batchDir(date), "index.json");
  return JSON.parse(fs.readFileSync(indexPath, "utf8")) as LocalDraftBatch;
}

function readDecisions(date: string): Record<string, DraftDecision> {
  const decisionsPath = path.join(batchDir(date), "decisions.json");
  if (!fs.existsSync(decisionsPath)) return {};
  return JSON.parse(fs.readFileSync(decisionsPath, "utf8")) as Record<string, DraftDecision>;
}

function writeDecisions(date: string, decisions: Record<string, DraftDecision>) {
  fs.writeFileSync(
    path.join(batchDir(date), "decisions.json"),
    `${JSON.stringify(decisions, null, 2)}\n`,
    "utf8",
  );
}

export function readPublished(date: string): PublishedRecord[] {
  const publishedPath = path.join(batchDir(date), "published.json");
  if (!fs.existsSync(publishedPath)) return [];
  return JSON.parse(fs.readFileSync(publishedPath, "utf8")) as PublishedRecord[];
}

function writePublished(date: string, rows: PublishedRecord[]) {
  fs.writeFileSync(
    path.join(batchDir(date), "published.json"),
    `${JSON.stringify(rows, null, 2)}\n`,
    "utf8",
  );
}

export function listLocalDrafts(date: string): LocalDraft[] {
  const batch = readBatch(date);
  const decisions = readDecisions(date);
  return batch.drafts.map((draft) => {
    const body = fs.readFileSync(path.join(batchDir(date), draft.file), "utf8");
    return {
      ...draft,
      status: decisions[draft.file] ?? "Ready for review",
      body,
    };
  });
}

export function setLocalDraftDecision(
  date: string,
  file: string,
  status: DraftDecision,
): LocalDraft {
  const batch = readBatch(date);
  const meta = batch.drafts.find((d) => d.file === file);
  if (!meta) throw new Error(`Unknown draft file: ${file}`);
  if (
    status !== "Approved" &&
    status !== "Kill" &&
    status !== "Ready for review" &&
    status !== "Published"
  ) {
    throw new Error(`Invalid status: ${status}`);
  }
  const decisions = readDecisions(date);
  decisions[file] = status;
  writeDecisions(date, decisions);
  const body = fs.readFileSync(path.join(batchDir(date), file), "utf8");
  return { ...meta, status, body };
}

export function recordLocalPublish(
  date: string,
  file: string,
  record: PublishedRecord,
): LocalDraft {
  const draft = setLocalDraftDecision(date, file, "Published");
  const rows = readPublished(date).filter((row) => row.file !== file && row.wikiId !== record.wikiId);
  rows.push({ ...record, file });
  writePublished(date, rows);
  return draft;
}

export function wikiDirForMatter(matter: string, title = ""): string {
  const t = title.toLowerCase();
  if (/energy|ombudsman|debt collector|credit card|bill in the wrong name|gas meter/.test(t)) {
    return "Areas/Money, Benefits and Debt/Tax and Bills";
  }
  if (/holiday|flight|festival|travel|jet2|airline|train refund|hotel/.test(t)) {
    return "Areas/Consumer Rights/Travel and Holidays";
  }
  if (/noise|asb|loud music|keeps you awake/.test(t)) {
    return "Areas/Neighbours and Property/Noise and Nuisance";
  }
  if (/parking|pcn|popla|blue badge/.test(t)) {
    return "Areas/Driving and Parking/Parking and PCNs";
  }
  if (/child arrangements|child.?s name|child maintenance|custody|parental/.test(t)) {
    return "Areas/Family and Relationships/Children";
  }
  return MATTER_TO_DIR[matter] || MATTER_TO_DIR.other;
}

/** Parse overlap wiki ids from the draft callout / body. */
export function overlapIdsFromDraft(body: string): string[] {
  const block = body.match(/Overlap wiki ids:\s*\n((?:[-*]\s+.+\n?)+)/i);
  if (!block) return [];
  return block[1]
    .split("\n")
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
}

/**
 * Fold a local Marketing Blog draft into the wiki sections the public page renders.
 * Keeps Summary / Key Information / Practical Guidance / Related Concepts /
 * Related Organisations / Sources. Folds "what they will / will not" into Key Information.
 */
export function draftBodyToWikiMarkdown(body: string, title: string): string {
  const cleaned = body
    .replace(/^>\s*\*\*Status:\*\*.+\n+/m, "")
    .replace(/^Overlap wiki ids:[\s\S]*?(?=\n## )/m, "")
    .trim();

  const sections = new Map<string, string>();
  const chunks = cleaned.split(/^##\s+/m);
  for (const part of chunks.slice(1)) {
    const nl = part.indexOf("\n");
    if (nl === -1) sections.set(part.trim(), "");
    else sections.set(part.slice(0, nl).trim(), part.slice(nl + 1).trim());
  }

  const get = (...names: string[]) => {
    for (const name of names) {
      for (const [heading, value] of sections) {
        if (heading.toLowerCase() === name.toLowerCase()) return value;
      }
    }
    return "";
  };

  const summary = get("Summary");
  let key = get("Key Information", "Key information");
  let practical = get("Practical Guidance", "Practical guidance");
  const nextStep = get("Next step");
  const sources = get("Sources");
  const related = get("Related Concepts");
  const orgs = get("Related Organisations");
  const law = get("What the law says in England and Wales");
  const howWeHelp = get("How Legal Shaman helps");
  const disclaimer = get("Disclaimer");

  const extras: string[] = [];
  for (const [heading, value] of sections) {
    if (/^what .+ would actually do here$/i.test(heading) && value.trim()) {
      extras.push(`- **${heading.replace(/^What /i, "").replace(/ would actually do here$/i, "")}:** ${value.replace(/\n+/g, " ").trim()}`);
    }
  }
  if (extras.length) {
    key = `${key.trim()}\n${extras.join("\n")}`.trim();
  }

  // Fold end CTA into Practical Guidance so the public wiki keeps Ask the Shaman → home.
  // Drafts with their own law / help sections keep Next step as a rendered section instead.
  const keepNextStep = Boolean(nextStep.trim() && (law.trim() || howWeHelp.trim()));
  if (keepNextStep) {
    // rendered from the Next step section on the public article
  } else if (nextStep.trim()) {
    const ctaLine =
      nextStep
        .split("\n")
        .map((l) => l.trim())
        .find((l) => /ask the shaman/i.test(l) && /legalshaman\.com/.test(l)) ||
      "- **[Ask the Shaman](https://www.legalshaman.com/)** on the Legal Shaman home page.";
    const bullet = ctaLine.startsWith("- ") ? ctaLine : `- ${ctaLine}`;
    if (!/ask the shaman/i.test(practical)) {
      practical = `${practical.trim()}\n${bullet}`.trim();
    }
  } else if (!/ask the shaman/i.test(practical)) {
    practical = `${practical.trim()}\n- **[Ask the Shaman](https://www.legalshaman.com/)** on the Legal Shaman home page.`.trim();
  }

  const stem = title.replace(/\?+$/, "").trim();
  const parts = [
    `# ${stem}?`,
    "",
    "## Summary",
    "",
    summary.trim() || "Signposting for this situation. Not legal advice.",
    "",
    "## Key Information",
    "",
    key.trim() || "- See the summary.",
    "",
    ...(law.trim() ? ["## What the law says in England and Wales", "", law.trim(), ""] : []),
    ...(howWeHelp.trim() ? ["## How Legal Shaman helps", "", howWeHelp.trim(), ""] : []),
    "## Practical Guidance",
    "",
    practical.trim() || "- Read the notice or letter you hold, then the free door named in the summary.",
  ];

  if (related.trim()) {
    parts.push("", "## Related Concepts", "", related.trim());
  }
  if (orgs.trim()) {
    parts.push("", "## Related Organisations", "", orgs.trim());
  }
  if (sources.trim()) {
    parts.push("", "## Sources", "", sources.trim());
  }
  if (keepNextStep) {
    parts.push("", "## Next step", "", nextStep.trim());
  }
  if (disclaimer.trim() && (law.trim() || howWeHelp.trim())) {
    parts.push("", "## Disclaimer", "", disclaimer.trim());
  }

  return `${parts.join("\n").trim()}\n`;
}

/** Tiny markdown → HTML for local review only (no deps). */
export function draftMarkdownToHtml(md: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    escape(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let inList = false;
  let inTable = false;

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  const closeTable = () => {
    if (inTable) {
      out.push("</tbody></table>");
      inTable = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("|") && line.includes("|")) {
      closeList();
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      const isSep = cells.every((c) => /^:?-+:?$/.test(c));
      if (!inTable) {
        out.push('<table class="w-full text-sm border-collapse my-4"><tbody>');
        inTable = true;
        if (!isSep) {
          out.push(
            `<tr>${cells.map((c) => `<th class="border border-border px-2 py-1 text-left">${inline(c)}</th>`).join("")}</tr>`,
          );
        }
      } else if (!isSep) {
        out.push(
          `<tr>${cells.map((c) => `<td class="border border-border px-2 py-1 align-top">${inline(c)}</td>`).join("")}</tr>`,
        );
      }
      i += 1;
      continue;
    }
    closeTable();

    if (/^>\s*/.test(line)) {
      closeList();
      out.push(`<blockquote class="border-l-4 border-amber-500/60 pl-3 my-3 text-sm text-muted-foreground">${inline(line.replace(/^>\s*/, ""))}</blockquote>`);
      i += 1;
      continue;
    }
    if (line.startsWith("### ")) {
      closeList();
      out.push(`<h3 class="mt-6 text-lg font-semibold">${inline(line.slice(4))}</h3>`);
      i += 1;
      continue;
    }
    if (line.startsWith("## ")) {
      closeList();
      out.push(`<h2 class="mt-8 text-xl font-semibold font-serif text-primary">${inline(line.slice(3))}</h2>`);
      i += 1;
      continue;
    }
    if (line.startsWith("# ")) {
      closeList();
      out.push(`<h1 class="mt-4 text-2xl font-bold font-serif">${inline(line.slice(2))}</h1>`);
      i += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        out.push('<ul class="my-3 list-disc space-y-1 pl-5">');
        inList = true;
      }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`);
      i += 1;
      continue;
    }
    closeList();
    if (!line.trim()) {
      i += 1;
      continue;
    }
    out.push(`<p class="my-3 leading-relaxed">${inline(line)}</p>`);
    i += 1;
  }
  closeList();
  closeTable();
  return out.join("\n");
}
