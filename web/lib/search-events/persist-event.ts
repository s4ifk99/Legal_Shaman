import "server-only";

import { prisma } from "@/lib/db/prisma";
import type { SearchEventInput } from "@/lib/search-events/types";
import { hashSessionId, queryPrefix, sanitizeEventMetadata } from "@/lib/search-events/privacy";

export async function persistSearchEvent(input: SearchEventInput): Promise<void> {
  await prisma.searchEvent.create({
    data: {
      sessionHash: hashSessionId(input.sessionId),
      searchInteractionId: input.searchInteractionId ?? null,
      queryPrefix: queryPrefix(input.query ?? ""),
      parsedPracticeArea: input.parsedPracticeArea ?? null,
      parsedLocation: input.parsedLocation ?? null,
      resultId: input.resultId ?? null,
      resultSource: input.resultSource ?? null,
      resultRank: input.resultRank ?? null,
      eventType: input.eventType,
      page: input.page,
      metadata: sanitizeEventMetadata(input.metadata) as object | undefined,
    },
  });
}
