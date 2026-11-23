import { NextResponse } from "next/server";
import {
  latestLocalBatchDate,
  listLocalDrafts,
  setLocalDraftDecision,
  type DraftDecision,
} from "@/lib/blog-drafts/local-queue";

export const runtime = "nodejs";

function guardDev() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Local review only" }, { status: 404 });
  }
  return null;
}

function resolveDate(raw: string | null | undefined): string {
  const requested = raw?.trim();
  if (requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)) return requested;
  const latest = latestLocalBatchDate();
  if (!latest) throw new Error("No local blog-draft batches found");
  return latest;
}

export async function GET(req: Request) {
  const blocked = guardDev();
  if (blocked) return blocked;
  const { searchParams } = new URL(req.url);
  try {
    const date = resolveDate(searchParams.get("date"));
    const drafts = listLocalDrafts(date).map(({ body: _body, ...meta }) => meta);
    return NextResponse.json({ date, drafts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list drafts" },
      { status: 400 },
    );
  }
}

export async function POST(req: Request) {
  const blocked = guardDev();
  if (blocked) return blocked;
  const payload = (await req.json()) as {
    date?: string;
    file?: string;
    status?: DraftDecision;
  };
  let date: string;
  try {
    date = resolveDate(payload.date);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "No batch date" },
      { status: 400 },
    );
  }
  const file = payload.file?.trim();
  const status = payload.status;
  if (
    !file ||
    (status !== "Approved" &&
      status !== "Kill" &&
      status !== "Ready for review" &&
      status !== "Published")
  ) {
    return NextResponse.json({ error: "file + status required" }, { status: 400 });
  }
  try {
    const draft = setLocalDraftDecision(date, file, status);
    return NextResponse.json({
      ok: true,
      draft: { file: draft.file, title: draft.title, status: draft.status },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save decision" },
      { status: 400 },
    );
  }
}
