import { NextResponse } from "next/server";

import { coherenceDatabaseUrl } from "@/lib/coherence/config";
import { coherenceApiGuard } from "@/lib/coherence/server/guard";
import { sraQuery } from "@/lib/coherence/server/sra-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;

  if (!coherenceDatabaseUrl()) {
    return NextResponse.json({
      configured: false,
      reachable: false,
      error: "DATABASE_URL not set",
    });
  }

  try {
    const r = await sraQuery<{ rows: { n: string }[] }>(
      "SELECT count(*)::text AS n FROM sra_organisations",
    );
    return NextResponse.json({
      configured: true,
      reachable: true,
      total: Number(r.rows[0]?.n || 0),
    });
  } catch (err) {
    return NextResponse.json({
      configured: true,
      reachable: false,
      error: err instanceof Error ? err.message : "db error",
    });
  }
}
