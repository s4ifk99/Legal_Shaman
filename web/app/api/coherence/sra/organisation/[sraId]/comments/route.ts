import { NextResponse } from "next/server";

import { coherenceDatabaseUrl } from "@/lib/coherence/config";
import { coherenceApiGuard } from "@/lib/coherence/server/guard";
import {
  ensureSraCommentsTable,
  mapCommentRow,
  sraQuery,
} from "@/lib/coherence/server/sra-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ sraId: string }> };

async function organisationExists(sraId: string): Promise<boolean> {
  const result = await sraQuery<{ rows: { ok: number }[] }>(
    "SELECT 1::int AS ok FROM sra_organisations WHERE sra_id = $1 LIMIT 1",
    [sraId],
  );
  return result.rows.length > 0;
}

export async function GET(_req: Request, ctx: Ctx) {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;

  const { sraId: rawId } = await ctx.params;
  const sraId = decodeURIComponent(rawId || "").trim();
  if (!sraId) {
    return NextResponse.json({ error: "SRA id required" }, { status: 400 });
  }
  if (!coherenceDatabaseUrl()) {
    return NextResponse.json(
      { comments: [], shared: false, error: "DATABASE_URL not set" },
      { status: 503 },
    );
  }

  try {
    await ensureSraCommentsTable();
    const result = await sraQuery<{ rows: Record<string, unknown>[] }>(
      `
      SELECT id, sra_id, author_name, body, created_at
      FROM sra_organisation_comments
      WHERE sra_id = $1
      ORDER BY created_at DESC
      LIMIT 100
    `,
      [sraId],
    );
    return NextResponse.json({
      comments: result.rows.map(mapCommentRow),
      shared: true,
    });
  } catch (err) {
    return NextResponse.json(
      {
        comments: [],
        shared: false,
        error: err instanceof Error ? err.message : "comments lookup failed",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;

  const { sraId: rawId } = await ctx.params;
  const sraId = decodeURIComponent(rawId || "").trim();
  if (!sraId) {
    return NextResponse.json({ error: "SRA id required" }, { status: 400 });
  }
  if (!coherenceDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL not set", shared: false }, { status: 503 });
  }

  try {
    const body = (await req.json()) as { authorName?: string; body?: string };
    const message = String(body.body || "")
      .replace(/\0/g, "")
      .trim();
    const authorName = String(body.authorName || "")
      .replace(/\0/g, "")
      .trim()
      .slice(0, 80);

    if (message.length < 1 || message.length > 2000) {
      return NextResponse.json(
        { error: "Message must be 1–2000 characters" },
        { status: 400 },
      );
    }

    await ensureSraCommentsTable();
    if (!(await organisationExists(sraId))) {
      return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
    }

    const result = await sraQuery<{ rows: Record<string, unknown>[] }>(
      `
      INSERT INTO sra_organisation_comments (sra_id, author_name, body)
      VALUES ($1, $2, $3)
      RETURNING id, sra_id, author_name, body, created_at
    `,
      [sraId, authorName || "Anonymous", message],
    );

    return NextResponse.json(
      {
        comment: mapCommentRow(result.rows[0]),
        shared: true,
      },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "comment post failed",
        shared: false,
      },
      { status: 500 },
    );
  }
}
