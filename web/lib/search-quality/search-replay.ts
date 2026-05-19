import "server-only";

import { prisma } from "@/lib/db/prisma";

export type SearchReplayTimeline = {
  interaction: {
    id: string;
    rawQuery: string;
    channel: string | null;
    resultCount: number | null;
    latencyMs: number | null;
    clarifyingAsked: boolean;
    mapUsed: boolean | null;
    createdAt: string;
    parsedQuery: unknown;
    degradedModes: unknown;
    typesenseQueries: unknown;
  };
  events: {
    id: string;
    eventType: string;
    queryPrefix: string;
    resultId: string | null;
    resultSource: string | null;
    resultRank: number | null;
    page: string;
    metadata: unknown;
    createdAt: string;
  }[];
};

export async function replaySearchInteraction(interactionId: string): Promise<SearchReplayTimeline | null> {
  const interaction = await prisma.searchInteraction.findUnique({
    where: { id: interactionId },
  });
  if (!interaction) return null;

  const events = await prisma.searchEvent.findMany({
    where: { searchInteractionId: interactionId },
    orderBy: { createdAt: "asc" },
  });

  return {
    interaction: {
      id: interaction.id,
      rawQuery: interaction.rawQuery,
      channel: interaction.channel,
      resultCount: interaction.resultCount,
      latencyMs: interaction.latencyMs,
      clarifyingAsked: interaction.clarifyingAsked,
      mapUsed: interaction.mapUsed,
      createdAt: interaction.createdAt.toISOString(),
      parsedQuery: interaction.parsedQuery,
      degradedModes: interaction.degradedModes,
      typesenseQueries: interaction.typesenseQueries,
    },
    events: events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      queryPrefix: e.queryPrefix,
      resultId: e.resultId,
      resultSource: e.resultSource,
      resultRank: e.resultRank,
      page: e.page,
      metadata: e.metadata,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}
