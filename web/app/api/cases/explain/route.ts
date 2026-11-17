import { NextResponse } from "next/server";
import { explainDisputeOptions } from "@/lib/cases/explain-options";
import type { DisputeKind } from "@/lib/cases/dispute-context";

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

export async function POST(req: Request) {
  // Guests may chat freely; account is only required for saved results / PDF email.
  let body: {
    kind?: string;
    story?: string;
    disputeAnswers?: Record<string, string>;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const kind = (KINDS.includes(body.kind as DisputeKind)
    ? body.kind
    : "general") as DisputeKind;
  const story = String(body.story || "").trim();
  if (!story) {
    return NextResponse.json({ error: "Story required" }, { status: 400 });
  }

  const result = await explainDisputeOptions({
    kind,
    story,
    disputeAnswers: body.disputeAnswers,
  });

  return NextResponse.json(result);
}
