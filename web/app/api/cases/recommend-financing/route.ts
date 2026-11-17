import { NextResponse } from "next/server";
import type { DisputeKind } from "@/lib/cases/dispute-context";
import type { FundingPreference } from "@/lib/cases/types";
import { buildFinancingMap } from "@/lib/cases/litigation-financing";

const KINDS: DisputeKind[] = [
  "divorce",
  "housing",
  "employment",
  "consumer",
  "debt",
  "neighbour",
  "benefits",
  "general",
];

const PREFS: FundingPreference[] = [
  "legal_aid",
  "pro_bono",
  "fixed_fee",
  "private",
  "unsure",
  "insurance",
];

export async function POST(req: Request) {
  let body: {
    kind?: string;
    story?: string;
    preference?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const story = String(body.story || "").trim();
  if (!story) {
    return NextResponse.json({ error: "Story required" }, { status: 400 });
  }

  const kind = (KINDS.includes(body.kind as DisputeKind)
    ? body.kind
    : "general") as DisputeKind;
  const preference = (PREFS.includes(body.preference as FundingPreference)
    ? body.preference
    : null) as FundingPreference | null;

  const map = buildFinancingMap({ kind, story, preference });

  return NextResponse.json({
    complexity: map.complexity,
    complexityReason: map.complexityReason,
    honestNote: map.honestNote,
    options: map.routes.map((r) => ({
      id: r.id,
      title: r.title,
      blurb: `${r.summary} ${r.whenItFits}`.trim(),
      likelihood: r.likelihood,
      url: r.sourceUrl,
      sourceLabel: r.sourceLabel,
    })),
    contacts: map.contacts.map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      blurb: c.blurb,
      url: c.url,
    })),
  });
}
