import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { accountsPrisma } from "@/lib/db/accounts";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { ensureCaseSchema } from "@/lib/cases/schema";
import { toCaseRecord } from "@/lib/cases/serialize";
import type { CaseUpsertInput } from "@/lib/cases/types";

function asJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return value as Prisma.InputJsonValue;
}

function createId(): string {
  return `case_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  await ensureCaseSchema();
  const rows = await accountsPrisma.consumerCase.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ cases: rows.map(toCaseRecord) });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  let body: CaseUpsertInput & { id?: string };
  try {
    body = (await req.json()) as CaseUpsertInput & { id?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  await ensureCaseSchema();

  const title =
    (typeof body.title === "string" && body.title.trim()) ||
    "Your situation";

  let row;
  if (body.id) {
    const existing = await accountsPrisma.consumerCase.findFirst({
      where: { id: body.id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }
    row = await accountsPrisma.consumerCase.update({
      where: { id: existing.id },
      data: {
        title,
        summary: body.summary ?? existing.summary,
        matterType: body.matterType ?? existing.matterType,
        jurisdiction: body.jurisdiction ?? existing.jurisdiction,
        locationHint: body.locationHint ?? existing.locationHint,
        status: body.status ?? existing.status,
        fundingKnowledge: body.fundingKnowledge ?? existing.fundingKnowledge,
        fundingPreference: body.fundingPreference ?? existing.fundingPreference,
        fundingNotes: body.fundingNotes ?? existing.fundingNotes,
        profileAnswers: asJson(body.profileAnswers ?? existing.profileAnswers),
        actionPlan: asJson(body.actionPlan ?? existing.actionPlan),
        sessionSnapshot: asJson(body.sessionSnapshot ?? existing.sessionSnapshot),
      },
    });
  } else {
    const open = await accountsPrisma.consumerCase.findFirst({
      where: { userId: user.id, status: { in: ["open", "exploring"] } },
      orderBy: { updatedAt: "desc" },
    });
    if (open) {
      row = await accountsPrisma.consumerCase.update({
        where: { id: open.id },
        data: {
          title,
          summary: body.summary ?? open.summary,
          matterType: body.matterType ?? open.matterType,
          jurisdiction: body.jurisdiction ?? open.jurisdiction,
          locationHint: body.locationHint ?? open.locationHint,
          status: body.status ?? open.status,
          fundingKnowledge: body.fundingKnowledge ?? open.fundingKnowledge,
          fundingPreference: body.fundingPreference ?? open.fundingPreference,
          fundingNotes: body.fundingNotes ?? open.fundingNotes,
          profileAnswers: asJson(body.profileAnswers ?? open.profileAnswers),
          actionPlan: asJson(body.actionPlan ?? open.actionPlan),
          sessionSnapshot: asJson(body.sessionSnapshot ?? open.sessionSnapshot),
        },
      });
    } else {
      row = await accountsPrisma.consumerCase.create({
        data: {
          id: createId(),
          userId: user.id,
          title,
          summary: body.summary ?? null,
          matterType: body.matterType ?? null,
          jurisdiction: body.jurisdiction ?? null,
          locationHint: body.locationHint ?? null,
          status: body.status ?? "open",
          fundingKnowledge: body.fundingKnowledge ?? null,
          fundingPreference: body.fundingPreference ?? null,
          fundingNotes: body.fundingNotes ?? null,
          profileAnswers: asJson(body.profileAnswers),
          actionPlan: asJson(body.actionPlan),
          sessionSnapshot: asJson(body.sessionSnapshot),
        },
      });
    }
  }

  await accountsPrisma.bookmark.updateMany({
    where: { userId: user.id, caseId: null },
    data: { caseId: row.id },
  });
  await accountsPrisma.providerNote.updateMany({
    where: { userId: user.id, caseId: null },
    data: { caseId: row.id },
  });

  return NextResponse.json({ case: toCaseRecord(row) });
}
