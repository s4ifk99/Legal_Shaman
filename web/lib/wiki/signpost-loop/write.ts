import "server-only";

import { chat } from "@/lib/llm/client";
import { z } from "zod";
import { parseJsonFromLlm } from "./parse-json";
import type { AdmittedEvidence, SignpostClassification } from "./types";

const WriteResultSchema = z.object({
  answer: z.string().min(1),
});

const WRITE_SYSTEM = `You write England and Wales signposting from admitted excerpts only. Not legal advice.

Rules:
- Answer the user's question from the admitted excerpts only.
- The first 2–4 sentences must answer the user's core ask directly.
  - If they ask whether supporting a cause or political speech (e.g. Palestine) is allowed, say that peaceful political expression is generally lawful speech in England and Wales unless a source says otherwise for the wording they use — and in the same opening say that fixing a poster without the owner's or highway authority's permission is a criminal offence when an admitted excerpt supports that.
  - Do not open with licensing procedure alone.
- Then one short block per facet, in the order the user would act (place/permission, local Kent enforcement, wording/content).
- Every statute, section, fine, and local penalty must appear in that facet's excerpt. Name the page.
- Do not use a page admitted for one facet to fill another.
- If a facet has no admitted page, say that part is unconfirmed and name the official body. Do not borrow a neighbouring page.
- If two councils state different penalties, quote each council. Do not merge them into one Kent-wide figure.
- If a volatile excerpt has a date, give the date.
- End with: this is general information, not legal advice.
- Do not predict an outcome.
- Do not describe how to commit an offence the sources say is unlawful.
- Return JSON: { "answer": "..." }.`;

export async function writeSignpostAnswer(opts: {
  question: string;
  classification: SignpostClassification;
  admitted: AdmittedEvidence[];
}): Promise<string | null> {
  const { question, classification, admitted } = opts;

  const byFacet = classification.facets.map((f) => {
    const rows = admitted.filter((a) => a.facetId === f.id);
    return {
      facetId: f.id,
      need: f.need,
      rows: rows.map((r) => ({
        title: r.title,
        url: r.url,
        date: r.date ?? null,
        excerpt: r.excerpt,
      })),
    };
  });

  const user = JSON.stringify({
    question: question.slice(0, 4000),
    jurisdiction: classification.jurisdiction,
    localBody: classification.localBody ?? null,
    boundary: classification.boundary ?? null,
    facets: byFacet,
  });

  try {
    const raw = await chat(
      [
        { role: "system", content: WRITE_SYSTEM },
        { role: "user", content: user },
      ],
      {
        jsonMode: true,
        temperature: 0.15,
        maxTokens: 1600,
        purpose: "final_synthesis",
        caller: "signpost-loop.write",
        // Prefer a fast chat model — LLM_SMALL_MODEL (e.g. qwen3-32b) is too slow here.
        model:
          process.env.SIGNPOST_WRITE_MODEL?.trim() ||
          process.env.LLM_MODEL?.trim() ||
          process.env.LLM_CHAT_MODEL?.trim() ||
          "openai/gpt-4o-mini",
        timeoutMs: 28_000,
      },
    );
    const parsed = WriteResultSchema.safeParse(parseJsonFromLlm(raw));
    if (!parsed.success) {
      console.warn(
        "[signpost-loop.write] schema/parse fail:",
        parsed.error.message,
        "raw:",
        String(raw || "").slice(0, 400),
      );
      return null;
    }
    const answer = parsed.data.answer.trim();
    return answer || null;
  } catch (err) {
    console.warn(
      "[signpost-loop.write] failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
