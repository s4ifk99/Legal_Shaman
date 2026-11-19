import "server-only";

import { chat } from "@/lib/llm/client";
import { parseJsonFromLlm } from "./parse-json";
import {
  SignpostClassificationSchema,
  type SignpostClassification,
} from "./types";

const CLASSIFY_SYSTEM = `You classify UK public-law signposting questions for England and Wales.
Return a single JSON object only (no markdown, no thinking, no prose). Shape:
{
  "jurisdiction": "England and Wales",
  "localBody": null or string,
  "askType": "short label",
  "boundary": null or string,
  "facets": [ 2 to 4 objects with id, need, query, scope ("allowlist"|"open"), volatile (boolean) ]
}
localBody = named council/authority if the user named one.
boundary = if they ask how to commit an offence: one line on the lawful route and consequence only.
scope "allowlist" for national law/regulators; "open" only when a named local body must be found.
volatile=true for proscription lists, fine levels, deadlines, commencement.
Do not invent a matter slug or statutes.
When the user asks about a political poster (e.g. Palestine), include separate facets for place/permission, local council enforcement if a place is named, and wording/proscription.`;

function smallModel(): string | undefined {
  return (
    process.env.LLM_SMALL_MODEL?.trim() ||
    process.env.LLM_MODEL?.trim() ||
    undefined
  );
}

async function classifyOnce(
  question: string,
  attempt: number,
): Promise<SignpostClassification> {
  const raw = await chat(
    [
      { role: "system", content: CLASSIFY_SYSTEM },
      {
        role: "user",
        content:
          attempt === 0
            ? question.slice(0, 4000)
            : `Return ONLY valid JSON for this question (no other text):\n\n${question.slice(0, 4000)}`,
      },
    ],
    {
      jsonMode: true,
      temperature: 0.1,
      maxTokens: 1400,
      model: smallModel(),
      purpose: "pack_classify",
      caller: "signpost-loop.classify",
      timeoutMs: 22_000,
      attempt,
    },
  );

  let parsed: unknown;
  try {
    parsed = parseJsonFromLlm(raw);
  } catch (err) {
    console.warn(
      "[signpost-loop.classify] invalid JSON attempt",
      attempt,
      "raw:",
      String(raw || "").slice(0, 500),
    );
    throw new Error(
      `signpost classify: invalid JSON (${err instanceof Error ? err.message : "parse"})`,
    );
  }

  const result = SignpostClassificationSchema.safeParse(parsed);
  if (!result.success) {
    console.warn(
      "[signpost-loop.classify] schema fail attempt",
      attempt,
      result.error.message,
      "raw:",
      String(raw || "").slice(0, 500),
    );
    throw new Error(`signpost classify: schema ${result.error.message}`);
  }
  return result.data;
}

export async function classifySignpostQuestion(
  question: string,
): Promise<SignpostClassification> {
  try {
    return await classifyOnce(question, 0);
  } catch (first) {
    console.warn(
      "[signpost-loop.classify] retrying after:",
      first instanceof Error ? first.message : first,
    );
    return await classifyOnce(question, 1);
  }
}
