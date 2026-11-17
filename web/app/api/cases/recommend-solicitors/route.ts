import { NextResponse } from "next/server";
import type { DisputeKind } from "@/lib/cases/dispute-context";
import {
  matchSolicitorsForCase,
  type SolicitorMatchMode,
} from "@/lib/cases/match-solicitors";

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

const MODES: SolicitorMatchMode[] = ["local", "online", "reviews", "unsure"];

export async function POST(req: Request) {
  // Guests may chat freely; solicitor matches use our SRA index (same as directory).
  let body: {
    kind?: string;
    story?: string;
    mode?: string;
    locationHint?: string;
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
  const mode = (MODES.includes(body.mode as SolicitorMatchMode)
    ? body.mode
    : "unsure") as SolicitorMatchMode;

  const result = await matchSolicitorsForCase({
    kind,
    story,
    mode,
    locationHint: body.locationHint || "",
  });

  return NextResponse.json(result);
}
