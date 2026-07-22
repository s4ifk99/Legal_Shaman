import { NextResponse } from "next/server";
import { accountsPrisma } from "@/lib/db/accounts";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { BookmarkDeleteSchema, BookmarkSchema } from "@/lib/bookmarks/schemas";
import type { BookmarkRecord } from "@/lib/bookmarks/types";

function toRecord(row: {
  id: string;
  entityId: string;
  resultSource: string;
  businessName: string;
  createdAt: Date;
}): BookmarkRecord {
  return {
    id: row.id,
    entityId: row.entityId,
    resultSource: row.resultSource as BookmarkRecord["resultSource"],
    businessName: row.businessName,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

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
    },
    update: { businessName },
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

  await accountsPrisma.bookmark.deleteMany({
    where: {
      userId: user.id,
      entityId: parsed.data.entityId,
      resultSource: parsed.data.resultSource,
    },
  });

  return NextResponse.json({ ok: true });
}
