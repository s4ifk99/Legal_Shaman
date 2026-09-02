import { NextResponse } from "next/server";

import { coherenceDatabaseUrl } from "@/lib/coherence/config";
import { coherenceApiGuard } from "@/lib/coherence/server/guard";
import {
  proxyCoherenceBackendPath,
  shouldProxySraToHomeBackend,
} from "@/lib/coherence/server/gateway";
import { sraQuery } from "@/lib/coherence/server/sra-db";
import { typesenseSraStatus } from "@/lib/coherence/server/sra-typesense-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;

  if (!coherenceDatabaseUrl()) {
    const ts = await typesenseSraStatus();
    if (ts.configured && ts.reachable) return NextResponse.json(ts);
    if (shouldProxySraToHomeBackend()) {
      return proxyCoherenceBackendPath({
        path: "/api/coherence/sra/status",
        method: "GET",
        timeoutMs: 12_000,
      });
    }
    return NextResponse.json({
      configured: ts.configured,
      reachable: ts.reachable,
      total: ts.total,
      error: ts.error || "sra_directory_unavailable",
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
    const ts = await typesenseSraStatus();
    if (ts.configured && ts.reachable) return NextResponse.json(ts);
    if (shouldProxySraToHomeBackend()) {
      return proxyCoherenceBackendPath({
        path: "/api/coherence/sra/status",
        method: "GET",
        timeoutMs: 12_000,
      });
    }
    return NextResponse.json({
      configured: true,
      reachable: false,
      error: err instanceof Error ? err.message : "db error",
    });
  }
}
