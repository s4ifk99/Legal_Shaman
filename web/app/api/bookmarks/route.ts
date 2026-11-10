import { NextResponse } from "next/server";
import { accountsPrisma } from "@/lib/db/accounts";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { ensureBookmarkSchema } from "@/lib/bookmarks/schema";
import {
  BookmarkDeleteSchema,
  BookmarkNoteSchema,
  BookmarkSchema,
} from "@/lib/bookmarks/schemas";
import type { BookmarkRecord, BookmarkStatus } from "@/lib/bookmarks/types";

function toRecord(row: {
  id: string;
  entityId: string;
  resultSource: string;
  businessName: string;
  note: string | null;
  nextAction: string | null;
  status: string;
  createdAt: Date;
  updatedAt?: Date;
}): BookmarkRecord {
  return {
    id: row.id,
    entityId: row.entityId,
    resultSource: row.resultSource as BookmarkRecord["resultSource"],
    businessName: row.businessName,
    note: row.note,
    nextAction: row.nextAction,
    status: (row.status || "not_contacted") as BookmarkStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString(),
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  await ensureBookmarkSchema();
  const rows = await accountsPrisma.bookmark.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    bookmarks: rows.map(toRecord),
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BookmarkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  await ensureBookmarkSchema();
  const { entityId, resultSource, businessName } = parsed.data;
  const bookmark = await accountsPrisma.bookmark.upsert({
    where: {
      userId_entityId_resultSource: {
        userId: user.id,
        entityId,
        resultSource,
      },
    },
    create: {
      userId: user.id,
      entityId,
      resultSource,
      businessName,
      status: "not_contacted",
    },
    update: { businessName },
  });

  return NextResponse.json({ bookmark: toRecord(bookmark) });
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BookmarkNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  await ensureBookmarkSchema();
  const { entityId, resultSource, note, nextAction, status } = parsed.data;
  const existing = await accountsPrisma.bookmark.findUnique({
    where: {
      userId_entityId_resultSource: {
        userId: user.id,
        entityId,
        resultSource,
      },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Bookmark not found" }, { status: 404 });
  }

  const bookmark = await accountsPrisma.bookmark.update({
    where: { id: existing.id },
    data: {
      ...(note !== undefined ? { note } : {}),
      ...(nextAction !== undefined ? { nextAction } : {}),
      ...(status !== undefined ? { status } : {}),
    },
  });

  return NextResponse.json({ bookmark: toRecord(bookmark) });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BookmarkDeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  await ensureBookmarkSchema();
  await accountsPrisma.bookmark.deleteMany({
    where: {
      userId: user.id,
      entityId: parsed.data.entityId,
      resultSource: parsed.data.resultSource,
    },
  });

  return NextResponse.json({ ok: true });
}
