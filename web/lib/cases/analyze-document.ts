import "server-only";

import { chat, type ChatMessage } from "@/lib/llm/client";
import {
  emptyDocumentBrief,
  type DocumentBrief,
} from "@/lib/cases/document-brief";

const SYSTEM = `You are Legal Shaman's document reader for UK legal signposting (not a solicitor).
Read the uploaded letter, notice, photo, or PDF text and extract structured facts.
Return ONLY valid JSON matching this shape:
{
  "docType": "short type e.g. parking_pcn | court_letter | deposit_deduction | university_letter | eviction_notice | other",
  "issuer": "organisation or null",
  "title": "short title or null",
  "summary": "2-4 plain English sentences of what the document is and what it asks",
  "keyFacts": ["bullet facts"],
  "amounts": ["£ amounts if any"],
  "dates": ["dates mentioned"],
  "deadlines": ["response/pay/appeal deadlines if any"],
  "references": ["case/PCN/claim numbers"],
  "keyQuotes": ["short verbatim quotes max 3"],
  "suggestedMatter": "one-line matter description for intake or null",
  "confidence": "high|medium|low",
  "missingFacts": ["what the reader still needs from the person"],
  "rightsFraming": "calm plain English on what rights/options may be relevant — signposting only, no 'you should sue' advice",
  "nextStepHints": ["practical next steps e.g. check appeal window, contact ADR, keep evidence"]
}
Rules:
- Never invent deadlines, amounts, or case numbers that are not visible.
- If the image is blurry or partial, set confidence to low and list missingFacts.
- UK-focused; prefer England & Wales framing unless Scotland/NI is clear.
- Do not claim to give legal advice.`;

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 12);
}

function parseBrief(raw: string, fallback: string): DocumentBrief {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as Record<string, unknown>;
    const confidenceRaw = String(parsed.confidence || "medium").toLowerCase();
    const confidence =
      confidenceRaw === "high" || confidenceRaw === "low" ? confidenceRaw : "medium";
    return {
      docType: String(parsed.docType || "unknown").trim() || "unknown",
      issuer: parsed.issuer ? String(parsed.issuer).trim() : null,
      title: parsed.title ? String(parsed.title).trim() : null,
      summary: String(parsed.summary || fallback).trim() || fallback,
      keyFacts: asStringArray(parsed.keyFacts),
      amounts: asStringArray(parsed.amounts),
      dates: asStringArray(parsed.dates),
      deadlines: asStringArray(parsed.deadlines),
      references: asStringArray(parsed.references),
      keyQuotes: asStringArray(parsed.keyQuotes).slice(0, 3),
      suggestedMatter: parsed.suggestedMatter
        ? String(parsed.suggestedMatter).trim()
        : null,
      confidence,
      missingFacts: asStringArray(parsed.missingFacts),
      rightsFraming: String(parsed.rightsFraming || "").trim(),
      nextStepHints: asStringArray(parsed.nextStepHints),
    };
  } catch {
    return emptyDocumentBrief(fallback);
  }
}

export async function analyzeDocumentBytes(opts: {
  bytes: Uint8Array;
  mime: string;
  fileName: string;
}): Promise<DocumentBrief> {
  const { bytes, mime, fileName } = opts;
  const fallback = `Uploaded file “${fileName}” (${mime}).`;

  if (mime === "text/plain") {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).slice(0, 12_000);
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `File name: ${fileName}\n\nDocument text:\n${text}`,
      },
    ];
    const raw = await chat(messages, {
      jsonMode: true,
      temperature: 0.1,
      maxTokens: 1200,
      timeoutMs: 60_000,
      purpose: "legacy_other",
      caller: "cases.analyze-document.text",
    });
    return parseBrief(raw, fallback);
  }

  const b64 = Buffer.from(bytes).toString("base64");
  const dataUrl = `data:${mime};base64,${b64}`;

  // PDFs: many OpenRouter vision models accept file as image_url data URL;
  // also pass a text nudge. If vision fails, caller gets emptyDocumentBrief.
  const userContent =
    mime === "application/pdf"
      ? ([
          {
            type: "text",
            text: `File name: ${fileName}\nThis is a PDF of a UK letter/notice. Extract the structured JSON.`,
          },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ] as const)
      : ([
          {
            type: "text",
            text: `File name: ${fileName}\nThis is a photo/scan of a UK letter, PCN, court paper, or similar. Extract the structured JSON.`,
          },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ] as const);

  try {
    const raw = await chat(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: [...userContent] },
      ],
      {
        jsonMode: true,
        temperature: 0.1,
        maxTokens: 1400,
        timeoutMs: 90_000,
        // Prefer a strong vision-capable default when available
        model: process.env.LLM_VISION_MODEL?.trim() || undefined,
        purpose: "legacy_other",
        caller: "cases.analyze-document.vision",
      },
    );
    return parseBrief(raw, fallback);
  } catch {
    return emptyDocumentBrief(
      `${fallback} I could not run vision on this file — please summarise it in a short message.`,
    );
  }
}
