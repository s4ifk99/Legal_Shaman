import { NextResponse } from "next/server";

import { fetchDirectoryEntity, fetchDirectoryEntityByName } from "@/lib/legal-search/fetch-directory-entity";
import type { SearchResultSource } from "@/lib/search-events/types";

export const runtime = "nodejs";

const SOURCES = new Set<SearchResultSource>([
  "sra",
  "legal_aid",
  "curated_listing",
  "lawyer",
  "firm",
]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const entityId = url.searchParams.get("entityId")?.trim() ?? "";
  const name = url.searchParams.get("name")?.trim() ?? "";
  const source = url.searchParams.get("source")?.trim() as SearchResultSource | undefined;

  if (name.length >= 2 && !entityId) {
    try {
      const row = await fetchDirectoryEntityByName(name);
      if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
      return NextResponse.json({ row });
    } catch (err) {
      console.error("[api/search/entity] name lookup", err);
      return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
    }
  }

  if (!entityId || !source || !SOURCES.has(source)) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  try {
    const row = await fetchDirectoryEntity(entityId, source);
    if (!row) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ row });
  } catch (err) {
    console.error("[api/search/entity]", err);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
}
