/**
 * Event type → legal issue slugs and retrieval intents.
 * Issues are legal problems; capacities (consumer, trader) live on PartyCapacity.
 */
import type { MatterEvent, MatterFrame } from "./types";
import { intentsForIssueSlug } from "./scopes";

/** Legal issue slugs supported by each event type (operative events, not backdrop). */
export const EVENT_TYPE_ISSUES: Record<string, string[]> = {
  brief_event: [],
  employment: ["employment"],
  vehicle_sale: ["consumer_vehicle_repair", "consumer"],
  vehicle_purchase: ["consumer_vehicle_repair", "consumer"],
  vehicle_repair: ["consumer_vehicle_repair", "consumer"],
  housing: ["housing"],
  neighbour_dispute: ["neighbour_dispute", "housing"],
  parking_pcn: ["parking_pcn"],
  collision: ["consumer", "employment"],
  consumer_services: ["consumer_services", "consumer"],
};

/** Extra retrieval phrases keyed by event type (relationship/context specific). */
export const EVENT_TYPE_RETRIEVAL_INTENTS: Record<string, string[]> = {
  vehicle_sale: [
    "private sale used car refund defective vehicle",
    "seller sold car broke down consumer rights",
  ],
  vehicle_purchase: ["buying a car dealer refund faulty vehicle MOT"],
  vehicle_repair: ["problem with a car repair garage consumer"],
  housing: ["landlord tenant disrepair section 21 deposit"],
  neighbour_dispute: ["neighbour noise nuisance barking dog"],
  parking_pcn: ["appealing parking ticket penalty charge notice"],
  consumer_services: ["builder poor workmanship consumer services trader"],
  collision: ["vehicle insurance claim collision lift home work"],
};

export type RetrievalIntentTrace = {
  eventId: string;
  eventType: string;
  issueSlug: string;
  intent: string;
  relationshipTypes: string[];
  source: "event-issue" | "issue-fallback";
};

export function defaultIssuesForEventType(eventType: string): string[] {
  return EVENT_TYPE_ISSUES[eventType] || [];
}

export function enrichEvent(
  partial: Omit<MatterEvent, "supportsIssues" | "participants" | "relationships" | "confidence"> & {
    supportsIssues?: string[];
    participants?: string[];
    relationships?: string[];
    confidence?: number;
    disputed?: boolean;
  },
): MatterEvent {
  const supportsIssues =
    partial.supportsIssues?.length
      ? partial.supportsIssues
      : defaultIssuesForEventType(partial.type);
  return {
    ...partial,
    description: partial.description,
    fact: partial.description,
    participants: partial.participants || [],
    relationships: partial.relationships || [],
    supportsIssues,
    disputed: partial.disputed ?? false,
    confidence: partial.confidence ?? 0.7,
  };
}

/** Build retrieval intents from disputed events → supported issues, with traceability. */
export function buildRetrievalPlan(
  frame: MatterFrame,
  submission = "",
): {
  intents: string[];
  traces: RetrievalIntentTrace[];
} {
  const intents = new Set<string>();
  const traces: RetrievalIntentTrace[] = [];
  const primarySlugs = frame.primaryIssues.map((i) => i.slug);
  const story = [
    submission,
    ...frame.events.map((e) => e.description),
    ...frame.concepts,
    ...frame.objectives,
  ]
    .filter(Boolean)
    .join("\n");

  const disputedEvents = frame.events.filter((e) => e.disputed);

  for (const ev of disputedEvents) {
    const relTypes = frame.relationships
      .filter((r) => r.appliesToEvents.includes(ev.id))
      .map((r) => r.type);

    const issueSlugs = [
      ...ev.supportsIssues.filter((s) => primarySlugs.includes(s) || !primarySlugs.length),
      ...ev.supportsIssues,
    ].filter((s, i, arr) => arr.indexOf(s) === i);

    for (const issueSlug of issueSlugs.slice(0, 3)) {
      for (const intent of intentsForIssueSlug(issueSlug, story)) {
        if (!intents.has(intent)) {
          intents.add(intent);
          traces.push({
            eventId: ev.id,
            eventType: ev.type,
            issueSlug,
            intent,
            relationshipTypes: relTypes,
            source: "event-issue",
          });
        }
      }
    }

    for (const intent of EVENT_TYPE_RETRIEVAL_INTENTS[ev.type] || []) {
      if (!intents.has(intent)) {
        intents.add(intent);
        traces.push({
          eventId: ev.id,
          eventType: ev.type,
          issueSlug: issueSlugs[0] || ev.type,
          intent,
          relationshipTypes: relTypes,
          source: "event-issue",
        });
      }
    }
  }

  // Fallback: primary issue intents when no disputed events traced
  if (traces.length === 0) {
    for (const slug of primarySlugs) {
      for (const intent of intentsForIssueSlug(slug, story)) {
        if (!intents.has(intent)) {
          intents.add(intent);
          traces.push({
            eventId: "",
            eventType: "",
            issueSlug: slug,
            intent,
            relationshipTypes: [],
            source: "issue-fallback",
          });
        }
      }
    }
    for (const slug of frame.secondaryIssues.slice(0, 2).map((i) => i.slug)) {
      for (const intent of intentsForIssueSlug(slug, story).slice(0, 2)) {
        if (!intents.has(intent)) {
          intents.add(intent);
          traces.push({
            eventId: "",
            eventType: "",
            issueSlug: slug,
            intent,
            relationshipTypes: [],
            source: "issue-fallback",
          });
        }
      }
    }
  }

  return { intents: [...intents], traces };
}

/** After issues are resolved, align disputed event supportsIssues with primary/secondary. */
export function syncEventIssueLinks(frame: MatterFrame): MatterFrame {
  const primary = frame.primaryIssues[0]?.slug;
  const allIssues = [
    ...frame.primaryIssues.map((i) => i.slug),
    ...frame.secondaryIssues.map((i) => i.slug),
  ];

  const events = frame.events.map((ev) => {
    if (!ev.disputed) return ev;
    const merged = [...new Set([...ev.supportsIssues, ...defaultIssuesForEventType(ev.type), primary].filter(Boolean))];
    const supportsIssues = merged.filter((s) => allIssues.includes(s) || defaultIssuesForEventType(ev.type).includes(s));
    const finalIssues = supportsIssues.length ? supportsIssues : merged.slice(0, 3);
    return { ...ev, supportsIssues: finalIssues.filter((s): s is string => Boolean(s)) };
  });

  return { ...frame, events };
}
