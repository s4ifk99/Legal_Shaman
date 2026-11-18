import { NextResponse } from "next/server";
import type { DisputeKind } from "@/lib/cases/dispute-context";
import { recommendServicesForMatter } from "@/lib/cases/recommend-services";

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
  let body: { kind?: string; story?: string };
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

  const result = await recommendServicesForMatter({ kind, story });
  return NextResponse.json(result);
}
