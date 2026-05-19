import "server-only";

import { prisma } from "@/lib/db/prisma";
import type { ParsedQuery } from "@/lib/legal-search/types";
import type { ExtractedFilters } from "@/lib/agent/types";
import type { MapBounds } from "@/lib/search/location";

type LogArgs = {
  sessionId?: string;
  channel: "directory" | "matcher";
  query: string;
  extracted?: ExtractedFilters;
  parsedQuery?: ParsedQuery;
  clarifyingAsked: boolean;
  resultIds: string[];
  latencyMs?: number;
  degradedModes?: string[];
  mapUsed?: boolean;
  mapBounds?: MapBounds;
  radiusMiles?: number;
  typesenseQueries?: unknown;
};

/**
 * Persists search telemetry. TODO: PII minimization — optional hashing of rawQuery.
 */
export async function logSearchInteraction(args: LogArgs): Promise<void> {
  try {
    await prisma.searchInteraction.create({
      data: {
        userSessionId: args.sessionId ?? null,
        rawQuery: args.query.slice(0, 2000),
        extractedFilters: (args.extracted ?? args.parsedQuery ?? {}) as object,
        clarifyingAsked: args.clarifyingAsked,
        resultLawyerIds: args.channel === "matcher" ? args.resultIds : [],
        channel: args.channel,
        latencyMs: args.latencyMs ?? null,
        degradedModes: args.degradedModes?.length ? args.degradedModes : undefined,
        resultCount: args.resultIds.length,
        parsedQuery: args.parsedQuery ? (args.parsedQuery as object) : undefined,
        unifiedResultIds: args.channel === "directory" ? args.resultIds : [],
        mapUsed: args.mapUsed ?? null,
        mapBounds: args.mapBounds ? (args.mapBounds as object) : undefined,
        radiusMiles: args.radiusMiles ?? null,
        typesenseQueries: args.typesenseQueries ? (args.typesenseQueries as object) : undefined,
      },
    });
  } catch (err) {
    console.warn("[legal-search.observability] SearchInteraction log failed:", err);
  }
}
