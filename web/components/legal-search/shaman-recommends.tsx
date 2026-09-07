"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { LegalSearchSourceHit } from "@/lib/legal-knowledge/types";

type ShamanRecommendsProps = {
  answer: string;
  sources?: LegalSearchSourceHit[];
  confidence?: number;
  className?: string;
};

const CITATION_RE = /\[(\d+)\]/g;
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** Section labels emitted by cursor-style grounded synthesis. */
const SECTION_LABEL_RE =
  /^(what the sources say|practical route|limits\s*\/\s*missing facts|who to report to|what to do now|bottom line|evidence to keep)$/i;

function renderInline(text: string, sources: LegalSearchSourceHit[]): ReactNode[] {
  // First expand markdown links, then citation chips.
  const withLinks: ReactNode[] = [];
  let last = 0;
  let linkKey = 0;
  const md = text.replace(/\r\n/g, "\n");
  for (const match of md.matchAll(MD_LINK_RE)) {
    const idx = match.index ?? 0;
    if (idx > last) {
      withLinks.push(...renderCitations(md.slice(last, idx), sources, `pre-${linkKey}`));
    }
    withLinks.push(
      <a
        key={`md-${linkKey++}`}
        href={match[2]}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-primary underline underline-offset-2"
      >
        {match[1]}
      </a>,
    );
    last = idx + match[0].length;
  }
  if (last < md.length) {
    withLinks.push(...renderCitations(md.slice(last), sources, `post-${linkKey}`));
  }
  return withLinks.length ? withLinks : renderCitations(md, sources, "plain");
}

function renderCitations(text: string, sources: LegalSearchSourceHit[], keyPrefix: string): ReactNode[] {
  const parts = text.split(CITATION_RE);
  const nodes: ReactNode[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    if (i % 2 === 1) {
      const index = Number(part);
      const source = sources[index - 1];
      nodes.push(
        <a
          key={`${keyPrefix}-cite-${i}-${index}`}
          href={source?.url ?? `#source-${index}`}
          target={source?.url ? "_blank" : undefined}
          rel={source?.url ? "noopener noreferrer" : undefined}
          className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary hover:bg-primary/25"
          title={source?.title ?? `Source ${index}`}
        >
          {index}
        </a>,
      );
      continue;
    }

    nodes.push(<span key={`${keyPrefix}-text-${i}`}>{part}</span>);
  }

  return nodes;
}

type AnswerBlock =
  | { kind: "section"; title: string; body: string }
  | { kind: "paragraph"; text: string };

function isSectionLabel(line: string): boolean {
  const cleaned = line.replace(/^\*\*|\*\*$/g, "").replace(/^#+\s*/, "").trim();
  if (!cleaned || cleaned.length > 100) return false;
  if (SECTION_LABEL_RE.test(cleaned)) return true;
  const words = cleaned.split(/\s+/).length;
  if (
    /^[A-Z]/.test(cleaned) &&
    !/[.!?]$/.test(cleaned) &&
    !/^The |^This |^Your |^On |^Matched |^Now:|^Area /i.test(cleaned) &&
    words >= 2 &&
    words <= 14
  ) {
    return true;
  }
  return false;
}

function bulletLines(body: string): string[] | null {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 1) return null;
  if (!lines.every((l) => /^[•\-*]\s+/.test(l) || /^\d+\.\s+/.test(l))) return null;
  return lines.map((l) => l.replace(/^[•\-*]\s+/, "").replace(/^\d+\.\s+/, "").trim());
}

function renderBody(body: string, sources: LegalSearchSourceHit[]) {
  const bullets = bulletLines(body);
  if (bullets) {
    return (
      <ul className="list-disc space-y-1.5 pl-5 text-[15px] leading-7 text-foreground">
        {bullets.map((item, i) => (
          <li key={`${i}-${item.slice(0, 24)}`}>{renderInline(item, sources)}</li>
        ))}
      </ul>
    );
  }
  return (
    <p className="whitespace-pre-wrap text-[15px] leading-7 text-foreground">
      {renderInline(body, sources)}
    </p>
  );
}

/** Normalise answer text into structured blocks (sections + paragraphs). */
function toBlocks(answer: string): { blocks: AnswerBlock[]; lowNote: string | null } {
  const lowConfidenceMatch = answer.match(/\n\nNote:\s*confidence is limited[\s\S]*$/i);
  const main = lowConfidenceMatch
    ? answer.slice(0, lowConfidenceMatch.index).trim()
    : answer.trim();
  const lowNote = lowConfidenceMatch?.[0].replace(/^\n\n/, "").trim() ?? null;

  const rawBlocks = main
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const blocks: AnswerBlock[] = [];

  for (const block of rawBlocks) {
    if (/^\[\d+\]/.test(block)) {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      const head = lines[0] ?? "";
      const titleMatch = head.match(/^\[(\d+)\]\s*(.+)$/);
      if (titleMatch) {
        const idx = titleMatch[1];
        const title = titleMatch[2]!.replace(/\s+\([^)]+\):\s*.+$/, "").trim();
        const body = lines.slice(1).join(" ").trim();
        blocks.push({
          kind: "paragraph",
          text: body
            ? `The guidance on ${title} notes that ${body.charAt(0).toLowerCase()}${body.slice(1)} [${idx}].`
            : `See ${title} for relevant guidance [${idx}].`,
        });
      }
      continue;
    }

    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2 && isSectionLabel(lines[0]!)) {
      blocks.push({
        kind: "section",
        title: lines[0]!.replace(/^\*\*|\*\*$/g, "").replace(/^#+\s*/, "").trim(),
        body: lines.slice(1).join("\n"),
      });
      continue;
    }

    if (lines.length === 1 && isSectionLabel(lines[0]!)) {
      blocks.push({
        kind: "section",
        title: lines[0]!.replace(/^\*\*|\*\*$/g, "").replace(/^#+\s*/, "").trim(),
        body: "",
      });
      continue;
    }

    if (block.includes("\n") && !block.includes("[1]")) {
      for (const line of lines) {
        blocks.push({ kind: "paragraph", text: line });
      }
      continue;
    }

    blocks.push({ kind: "paragraph", text: block });
  }

  // Pair empty section labels with the following paragraph.
  const paired: AnswerBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const cur = blocks[i]!;
    const next = blocks[i + 1];
    if (cur.kind === "section" && !cur.body && next?.kind === "paragraph") {
      paired.push({ kind: "section", title: cur.title, body: next.text });
      i += 1;
      continue;
    }
    paired.push(cur);
  }

  return { blocks: paired, lowNote };
}

export function ShamanRecommends({
  answer,
  sources = [],
  confidence,
  className,
}: ShamanRecommendsProps) {
  const { blocks, lowNote } = toBlocks(answer);

  return (
    <div className={cn("space-y-3", className)}>
      {blocks.map((block, i) => {
        if (block.kind === "section") {
          return (
            <div
              key={`section-${i}-${block.title}`}
              className="rounded-xl border border-border/70 bg-background px-4 py-3.5 shadow-sm"
            >
              <h4 className="text-sm font-semibold tracking-tight text-foreground">{block.title}</h4>
              {block.body ? <div className="mt-2">{renderBody(block.body, sources)}</div> : null}
            </div>
          );
        }
        return (
          <div
            key={`para-${i}-${block.text.slice(0, 48)}`}
            className="rounded-xl border border-border/70 bg-background px-4 py-3.5 shadow-sm"
          >
            <p className="text-[15px] leading-7 text-foreground">{renderInline(block.text, sources)}</p>
          </div>
        );
      })}

      {lowNote ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          {lowNote}
        </p>
      ) : confidence != null && confidence < 0.38 ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          Confidence is limited — please check the cited sources carefully.
        </p>
      ) : null}
    </div>
  );
}

/** @deprecated Use ShamanRecommends */
export const SignpostingSummary = ShamanRecommends;
