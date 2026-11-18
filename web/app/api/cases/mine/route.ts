import { NextResponse } from "next/server";
import { accountsPrisma } from "@/lib/db/accounts";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { ensureCaseSchema } from "@/lib/cases/schema";
import { toCaseRecord } from "@/lib/cases/serialize";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  await ensureCaseSchema();
  const row = await accountsPrisma.consumerCase.findFirst({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
  });

  if (!row) {
    return NextResponse.json({ case: null });
  }

  const bookmarks = await accountsPrisma.bookmark.findMany({
    where: { userId: user.id, OR: [{ caseId: row.id }, { caseId: null }] },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json({
    case: toCaseRecord(row),
    bookmarks: bookmarks.map((b) => ({
      id: b.id,
      businessName: b.businessName,
      entityId: b.entityId,
      resultSource: b.resultSource,
      note: b.note,
      status: b.status,
    })),
  });
}
