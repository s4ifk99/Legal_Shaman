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

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const { id } = await ctx.params;
  let body: CaseUpsertInput;
  try {
    body = (await req.json()) as CaseUpsertInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  await ensureCaseSchema();
  const existing = await accountsPrisma.consumerCase.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  const row = await accountsPrisma.consumerCase.update({
    where: { id: existing.id },
    data: {
      title: body.title?.trim() || existing.title,
      summary: body.summary !== undefined ? body.summary : existing.summary,
      matterType: body.matterType !== undefined ? body.matterType : existing.matterType,
      jurisdiction:
        body.jurisdiction !== undefined ? body.jurisdiction : existing.jurisdiction,
      locationHint:
        body.locationHint !== undefined ? body.locationHint : existing.locationHint,
      status: body.status ?? existing.status,
      fundingKnowledge:
        body.fundingKnowledge !== undefined
          ? body.fundingKnowledge
          : existing.fundingKnowledge,
      fundingPreference:
        body.fundingPreference !== undefined
          ? body.fundingPreference
          : existing.fundingPreference,
      fundingNotes:
        body.fundingNotes !== undefined ? body.fundingNotes : existing.fundingNotes,
      profileAnswers:
        body.profileAnswers !== undefined
          ? asJson(body.profileAnswers)
          : asJson(existing.profileAnswers),
      actionPlan:
        body.actionPlan !== undefined ? asJson(body.actionPlan) : asJson(existing.actionPlan),
      sessionSnapshot:
        body.sessionSnapshot !== undefined
          ? asJson(body.sessionSnapshot)
          : asJson(existing.sessionSnapshot),
    },
  });

  return NextResponse.json({ case: toCaseRecord(row) });
}
