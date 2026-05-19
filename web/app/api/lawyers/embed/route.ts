import { NextResponse } from "next/server";
import { z } from "zod";

import { embedAllLawyers, embedLawyers } from "@/lib/lawyers/embed";

export const runtime = "nodejs";

const Input = z
  .object({
    ids: z.array(z.string().trim().min(1).max(64)).max(500).optional(),
    all: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.all) || (v.ids && v.ids.length > 0), {
    message: "Provide either `all: true` or a non-empty `ids` array.",
  });

/**
 * POST /api/lawyers/embed
 * Admin-only: regenerates embeddings for one or more lawyers.
 * Auth: `Authorization: Bearer $ADMIN_TOKEN`.
 */
export async function POST(req: Request) {
  const expected = process.env.ADMIN_TOKEN?.trim();
  if (!expected) {
    return NextResponse.json(
      { error: "ADMIN_TOKEN not configured on the server" },
      { status: 503 },
    );
  }
  const auth = req.headers.get("authorization") || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = Input.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const updated = parsed.data.all
      ? await embedAllLawyers()
      : await embedLawyers(parsed.data.ids!);
    return NextResponse.json({ updated });
  } catch (err) {
    console.error("[/api/lawyers/embed POST] failure:", err);
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json({ error: "embed_failed", message }, { status: 500 });
  }
}
