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

function renderTextWithCitations(text: string, sources: LegalSearchSourceHit[]) {
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
          key={`cite-${i}-${index}`}
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

    nodes.push(<span key={`text-${i}`}>{part}</span>);
  }

  return nodes;
}

/** Normalise answer text into paragraph strings (no source-card blocks in the recommendation). */
function toParagraphs(answer: string): { paragraphs: string[]; lowNote: string | null } {
  const lowConfidenceMatch = answer.match(/\n\nNote:\s*confidence is limited[\s\S]*$/i);
  const main = lowConfidenceMatch
    ? answer.slice(0, lowConfidenceMatch.index).trim()
    : answer.trim();
  const lowNote = lowConfidenceMatch?.[0].replace(/^\n\n/, "").trim() ?? null;

  const rawBlocks = main
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const paragraphs: string[] = [];

  for (const block of rawBlocks) {
    if (/^\[\d+\]/.test(block)) {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      const head = lines[0] ?? "";
      const titleMatch = head.match(/^\[(\d+)\]\s*(.+)$/);
      if (titleMatch) {
        const idx = titleMatch[1];
        const title = titleMatch[2]!.replace(/\s+\([^)]+\):\s*.+$/, "").trim();
        const body = lines.slice(1).join(" ").trim();
        paragraphs.push(
          body
            ? `The guidance on ${title} notes that ${body.charAt(0).toLowerCase()}${body.slice(1)} [${idx}].`
            : `See ${title} for relevant guidance [${idx}].`,
        );
      }
      continue;
    }

    if (block.includes("\n") && !block.includes("[1]")) {
      for (const line of block.split("\n").map((l) => l.trim()).filter(Boolean)) {
        paragraphs.push(line);
      }
      continue;
    }

    paragraphs.push(block);
  }

  return { paragraphs, lowNote };
}

export function ShamanRecommends({
  answer,
  sources = [],
  confidence,
  className,
}: ShamanRecommendsProps) {
  const { paragraphs, lowNote } = toParagraphs(answer);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="space-y-4">
        {paragraphs.map((paragraph) => (
          <p
            key={paragraph.slice(0, 64)}
            className="text-[15px] leading-7 text-foreground"
          >
            {renderTextWithCitations(paragraph, sources)}
          </p>
        ))}
      </div>

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
