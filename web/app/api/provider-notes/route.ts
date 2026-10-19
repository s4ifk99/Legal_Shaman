import { NextResponse } from "next/server";
import { accountsPrisma } from "@/lib/db/accounts";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { ProviderNoteUpsertSchema } from "@/lib/provider-notes/schema";
import {
  PROVIDER_NOTE_STATUSES,
  type ProviderNoteRecord,
  type ProviderNoteStatus,
} from "@/lib/provider-notes/types";

function asStatus(value: string): ProviderNoteStatus {
  return (PROVIDER_NOTE_STATUSES as readonly string[]).includes(value)
    ? (value as ProviderNoteStatus)
    : "not_contacted";
}

function toRecord(row: {
  id: string;
  providerKey: string;
  displayName: string;
  url: string | null;
  status: string;
  contactedOn: string | null;
  contactName: string | null;
  whatTheySaid: string | null;
  feesOrEligibility: string | null;
  followUp: string | null;
  impression: string | null;
  shortlisted: boolean;
  updatedAt: Date;
}): ProviderNoteRecord {
  return {
    id: row.id,
    providerKey: row.providerKey,
    displayName: row.displayName,
    url: row.url,
    status: asStatus(row.status),
    contactedOn: row.contactedOn,
    contactName: row.contactName,
    whatTheySaid: row.whatTheySaid,
    feesOrEligibility: row.feesOrEligibility,
    followUp: row.followUp,
    impression: row.impression,
    shortlisted: row.shortlisted,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const rows = await accountsPrisma.providerNote.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ notes: rows.map(toRecord) });
}

export async function PUT(req: Request) {
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

  const parsed = ProviderNoteUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const note = await accountsPrisma.providerNote.upsert({
    where: {
      userId_providerKey: {
        userId: user.id,
        providerKey: data.providerKey,
      },
    },
    create: {
      userId: user.id,
      providerKey: data.providerKey,
      displayName: data.displayName,
      url: data.url,
      status: data.status,
      contactedOn: data.contactedOn,
      contactName: data.contactName,
      whatTheySaid: data.whatTheySaid,
      feesOrEligibility: data.feesOrEligibility,
      followUp: data.followUp,
      impression: data.impression,
      shortlisted: data.shortlisted,
    },
    update: {
      displayName: data.displayName,
      url: data.url,
      status: data.status,
      contactedOn: data.contactedOn,
      contactName: data.contactName,
      whatTheySaid: data.whatTheySaid,
      feesOrEligibility: data.feesOrEligibility,
      followUp: data.followUp,
      impression: data.impression,
      shortlisted: data.shortlisted,
    },
  });

  return NextResponse.json({ note: toRecord(note) });
}
