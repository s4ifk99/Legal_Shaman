import { NextResponse } from "next/server";
import { z } from "zod";
import { runTriageSearch } from "@/lib/legal-search/triage/run-triage-search";
import type { AppliedFilters } from "@/lib/agent/types";
import { AppliedFiltersSchema } from "@/lib/agent/types";
import type { LatLng } from "@/lib/search/location";
import { requireSearchAuthResponse } from "@/lib/auth/require-search-auth";

export const runtime = "nodejs";

const TriageStateSchema = z.object({
  sessionId: z.string(),
  initialQuery: z.string(),
  mergedQuery: z.string(),
  answers: z.record(z.string()).optional(),
  stepsCompleted: z.array(z.string()),
  taxonomySlug: z.string().nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  fundingRoutes: z.array(z.enum(["legal_aid", "pro_bono", "private", "mixed"])),
  fundingPreference: z.enum(["legal_aid", "pro_bono", "fixed_fee", "private", "unsure"]),
  urgency: z.enum(["normal", "elevated", "urgent"]),
  riskFlags: z.array(z.string()),
  clientType: z.enum(["individual", "business", "charity", "unsure"]),
});

const AppliedFiltersBody = AppliedFiltersSchema.optional();

const SearchOriginSchema = z
  .object({
    lat: z.number().finite(),
    lng: z.number().finite(),
  })
  .optional();

const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    query: z.string().trim().min(2).max(800),
    sessionId: z.string().trim().min(1).max(128).optional(),
    appliedFilters: AppliedFiltersBody,
    searchOrigin: SearchOriginSchema,
  }),
  z.object({
    action: z.literal("answer"),
    state: z.custom<TriageState>(),
    field: z.string(),
    value: z.string().trim().min(1).max(400),
    sessionId: z.string().optional(),
    appliedFilters: AppliedFiltersBody,
    searchOrigin: SearchOriginSchema,
  }),
  z.object({
    action: z.literal("skip"),
    state: z.custom<TriageState>(),
    field: z.string(),
    sessionId: z.string().optional(),
    appliedFilters: AppliedFiltersBody,
    searchOrigin: SearchOriginSchema,
  }),
  z.object({
    action: z.literal("refine"),
    state: z.custom<TriageState>(),
    sessionId: z.string().optional(),
    appliedFilters: AppliedFiltersBody,
    searchOrigin: SearchOriginSchema,
  }),
  z.object({
    action: z.literal("restart"),
    sessionId: z.string().trim().min(1).max(128),
    query: z.string().trim().min(0).max(800).optional(),
    appliedFilters: AppliedFiltersBody,
    searchOrigin: SearchOriginSchema,
  }),
]);

export async function POST(req: Request) {
  const authBlock = await requireSearchAuthResponse();
  if (authBlock) return authBlock;

  try {
    const json = await req.json();
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const body = parsed.data;
    const sessionId =
      ("sessionId" in body && body.sessionId) ||
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s-${Date.now()}`);

    const appliedFilters =
      "appliedFilters" in body ? body.appliedFilters : undefined;
    const searchOrigin =
      "searchOrigin" in body ? (body.searchOrigin as LatLng | undefined) : undefined;

    if (body.action === "start") {
      const result = await runTriageSearch({
        action: "start",
        query: body.query,
        sessionId,
        appliedFilters,
        searchOrigin,
      });
      return NextResponse.json(result);
    }

    if (body.action === "restart") {
      const q = body.query?.trim() || "";
      if (q.length >= 2) {
        const result = await runTriageSearch({
          action: "start",
          query: q,
          sessionId,
          appliedFilters,
          searchOrigin,
        });
        return NextResponse.json(result);
      }
      return NextResponse.json({
        kind: "triage_question",
        triageState: {
          sessionId,
          initialQuery: "",
          mergedQuery: "",
          answers: {},
          stepsCompleted: [],
          taxonomySlug: null,
          confidence: "low",
          fundingRoutes: [],
          fundingPreference: "unsure",
          urgency: "normal",
          riskFlags: [],
          clientType: "unsure",
        },
        question: {
          field: "subIssue",
          prompt: "Describe your legal issue to get started.",
          allowSkip: false,
        },
        disclaimer:
          "This tool helps you find legal providers. It does not provide legal advice.",
      });
    }

    const state = body.state as TriageState;

    if (body.action === "refine") {
      const result = await runTriageSearch({
        action: "refine",
        sessionId: state.sessionId,
        state,
        appliedFilters,
        searchOrigin,
      });
      return NextResponse.json(result);
    }

    const field = body.field as keyof TriageState["answers"] | "subIssue";

    if (body.action === "answer") {
      const result = await runTriageSearch({
        action: "answer",
        sessionId: state.sessionId,
        state,
        field,
        value: body.value,
        appliedFilters,
        searchOrigin,
      });
      return NextResponse.json(result);
    }

    const result = await runTriageSearch({
      action: "skip",
      sessionId: state.sessionId,
      state,
      field,
      appliedFilters,
      searchOrigin,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Triage failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
