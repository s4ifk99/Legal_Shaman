import { NextResponse } from "next/server";
import { z } from "zod";
import { accountsPrisma } from "@/lib/db/accounts";
import { requireAdminApiRequest } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  firmName: z.string().trim().min(1).max(512),
  firmEmail: z.string().trim().email().max(255).optional().nullable(),
  areaOfLaw: z.string().trim().min(1).max(255),
  notes: z.string().trim().max(2000).optional().nullable(),
});

const UpdateSchema = z.object({
  id: z.string().trim().min(1),
  status: z.enum(["sent", "responded", "no_reply", "declined"]).optional(),
  costSummary: z.string().trim().max(1000).nullable().optional(),
  capacitySummary: z.string().trim().max(1000).nullable().optional(),
  eligibilityNote: z.string().trim().max(1000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function GET(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  const rows = await accountsPrisma.providerEnquiry.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ enquiries: rows });
}

export async function POST(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const row = await accountsPrisma.providerEnquiry.create({
    data: {
      firmName: parsed.data.firmName,
      firmEmail: parsed.data.firmEmail || null,
      areaOfLaw: parsed.data.areaOfLaw,
      notes: parsed.data.notes || null,
      status: "sent",
    },
  });
  return NextResponse.json({ enquiry: row });
}

export async function PATCH(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const { id, ...rest } = parsed.data;
  const data: Record<string, unknown> = { ...rest };
  if (rest.status === "responded") {
    data.respondedAt = new Date();
  }

  const row = await accountsPrisma.providerEnquiry.update({
    where: { id },
    data,
  });
  return NextResponse.json({ enquiry: row });
}
