import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { accountsPrisma } from "@/lib/db/accounts";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { ensureCaseSchema } from "@/lib/cases/schema";
import { toCaseRecord } from "@/lib/cases/serialize";
import type { CaseAttachment } from "@/lib/cases/types";
import type { DocumentBrief } from "@/lib/cases/document-brief";
import {
  UPLOAD_MAX_BYTES,
  UPLOAD_MAX_FILES,
  validateUploadBytes,
} from "@/lib/cases/upload-safety";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const { id } = await ctx.params;
  await ensureCaseSchema();
  const existing = await accountsPrisma.consumerCase.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  if (file.size > UPLOAD_MAX_BYTES) {
    return NextResponse.json(
      { error: "File too large (max about 5 MB)" },
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

  const prev = Array.isArray(existing.attachments)
    ? (existing.attachments as CaseAttachment[])
    : [];
  if (prev.length >= UPLOAD_MAX_FILES) {
    return NextResponse.json({ error: "Too many uploads on this case" }, { status: 400 });
  }

  let extractedBrief: DocumentBrief | null = null;
  const briefRaw = form.get("extractedBrief");
  if (typeof briefRaw === "string" && briefRaw.trim()) {
    try {
      extractedBrief = JSON.parse(briefRaw) as DocumentBrief;
    } catch {
      extractedBrief = null;
    }
  }

  const dataUrl = `data:${safety.mime};base64,${buffer.toString("base64")}`;
  const attachment: CaseAttachment = {
    id: `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: safety.safeName,
    mime: safety.mime,
    size: file.size,
    dataUrl,
    uploadedAt: new Date().toISOString(),
    extractedBrief,
  };

  const next = [...prev, attachment];
  const row = await accountsPrisma.consumerCase.update({
    where: { id: existing.id },
    data: { attachments: next as unknown as Prisma.InputJsonValue },
  });

  return NextResponse.json({
    case: toCaseRecord(row),
    attachment: { ...attachment, dataUrl: undefined },
  });
}
