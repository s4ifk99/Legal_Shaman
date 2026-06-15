import { NextResponse } from "next/server";
import { runDirectorySearch } from "@/lib/legal-search/run-directory-search";
import { enableMapSearch, enableSearchDebug } from "@/lib/legal-search/config";
import { buildMapMarkers } from "@/lib/search/map-results";
import { logSearchInteraction } from "@/lib/legal-search/observability";
import { parseMapBounds, boundsCenter } from "@/lib/search/location";

export const runtime = "nodejs";

/** Map markers + filtered results for viewport bounds. */
export async function GET(req: Request) {
  if (!enableMapSearch()) {
    return NextResponse.json({ error: "map_search_disabled" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const sessionId = (searchParams.get("sessionId") || "").trim() || undefined;
  const limit = Math.min(80, Math.max(1, Number(searchParams.get("limit") || 60) || 60));
  const bounds = parseMapBounds({
    north: searchParams.get("north") ?? undefined,
    south: searchParams.get("south") ?? undefined,
    east: searchParams.get("east") ?? undefined,
    west: searchParams.get("west") ?? undefined,
  });

  if (!q || q.length < 2) {
    return NextResponse.json({
      results: [],
      markers: [],
      missingCoordinatesCount: 0,
    });
  }

  if (!bounds) {
    return NextResponse.json(
      { error: "bounds_required", message: "Provide north, south, east, west." },
      { status: 400 },
    );
  }

  const origin = boundsCenter(bounds);
  const dir = await runDirectorySearch({
    query: q,
    limit,
    semantic: false,
    mapBounds: bounds,
    origin,
    freeOnly: searchParams.get("free") === "1",
    legalAidOnly: searchParams.get("legalAid") === "1",
    city: (searchParams.get("city") || "").trim() || undefined,
    source: (searchParams.get("source") || "").trim() || undefined,
    practiceArea: (searchParams.get("practiceArea") || "").trim() || undefined,
    location: (searchParams.get("location") || "").trim() || undefined,
    language: (searchParams.get("language") || "").trim() || undefined,
    verifiedOnly: searchParams.get("verifiedOnly") === "1",
  });

  const payload = buildMapMarkers(dir.results, { bounds, origin });

  if (sessionId) {
    void logSearchInteraction({
      sessionId,
      channel: "directory",
      query: q,
      parsedQuery: dir.parsedQuery,
      clarifyingAsked: false,
      resultIds: dir.results.map((r) => r.id),
      latencyMs: dir.latencyMs,
      degradedModes: dir.degradedModes,
      mapUsed: true,
      mapBounds: bounds,
      typesenseQueries: { endpoint: "map", bounds },
    });
  }

  const base = {
    ...payload,
    degradedModes: dir.degradedModes,
    latencyMs: dir.latencyMs,
  };

  if (enableSearchDebug()) {
    return NextResponse.json({
      ...base,
      parsedQuery: dir.parsedQuery,
    });
  }

  return NextResponse.json(base);
}
