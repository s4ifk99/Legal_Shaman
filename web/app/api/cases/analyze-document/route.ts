import { NextResponse } from "next/server";
import { analyzeDocumentBytes } from "@/lib/cases/analyze-document";
import {
  formatDocumentBriefForChat,
  documentBriefToStorySeed,
} from "@/lib/cases/document-brief";
import {
  UPLOAD_MAX_BYTES,
  validateUploadBytes,
} from "@/lib/cases/upload-safety";
import { llmConfigured } from "@/lib/llm/client";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: Request) {
  if (!llmConfigured()) {
    return NextResponse.json(
      { error: "Document reading is temporarily unavailable." },
      { status: 503 },
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  if (file.size > UPLOAD_MAX_BYTES) {
    return NextResponse.json(
      { error: "File too large (max about 5 MB)." },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const safety = validateUploadBytes({
    name: file.name,
    declaredMime: file.type,
    size: file.size,
    bytes: new Uint8Array(buffer),
  });
  if (!safety.ok) {
    return NextResponse.json({ error: safety.error }, { status: 400 });
  }

  const brief = await analyzeDocumentBytes({
    bytes: new Uint8Array(buffer),
    mime: safety.mime,
    fileName: safety.safeName,
  });

  const chatText = formatDocumentBriefForChat(brief, safety.safeName);
  const storySeed = documentBriefToStorySeed(brief);

  return NextResponse.json({
    brief,
    chatText,
    storySeed,
    fileName: safety.safeName,
    mime: safety.mime,
    size: file.size,
    dataUrl: `data:${safety.mime};base64,${buffer.toString("base64")}`,
  });
}
