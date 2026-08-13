import type { MatterFrame } from "./types";

export type MatterInspectorView = {
  matterId: string;
  resolutionStatus: string;
  primary: { slug: string; confidence: number; reason: string }[];
  secondary: { slug: string; confidence: number }[];
  parties: string[];
  relationships: string[];
  capacities: string[];
  events: string[];
  eventIssueLinks: string[];
  retrievalTraces: string[];
  excluded: string[];
  ambiguities: string[];
  retrievalScope: string[];
  overallConfidence: number;
  text: string;
};

export function formatMatterInspector(frame: MatterFrame): MatterInspectorView {
  const primary = frame.primaryIssues.map((i) => ({
    slug: i.slug,
    confidence: Math.round(i.confidence * 100) / 100,
    reason: i.reason,
  }));
  const secondary = frame.secondaryIssues.map((i) => ({
    slug: i.slug,
    confidence: Math.round(i.confidence * 100) / 100,
  }));
  const parties = frame.parties.map((p) => `${p.id}: ${p.label} (${p.role})`);
  const relationships = frame.relationships.map(
    (r) =>
      `${r.partyA} ↔ ${r.partyB}  ${r.type}  [${r.appliesToEvents.join(", ")}]  ${r.confidence.toFixed(2)}`,
  );
  const capacities = frame.capacities.map(
    (c) =>
      `${c.partyId}: ${c.capacity}` +
      (c.appliesToEvents?.length ? ` [${c.appliesToEvents.join(", ")}]` : "") +
      `  ${c.confidence.toFixed(2)}`,
  );
  const events = frame.events.map(
    (e) =>
      `${e.id} (${e.type})${e.disputed ? " *dispute*" : ""}: ${e.description} → issues [${e.supportsIssues.join(", ")}]`,
  );
  const eventIssueLinks = frame.events
    .filter((e) => e.disputed && e.supportsIssues.length)
    .map((e) => `${e.id} → ${e.supportsIssues.join(", ")}`);
  const retrievalTraces = (frame.provenance.retrievalTraces as { eventId: string; issueSlug: string; intent: string }[] | undefined)?.map(
    (t) => `${t.eventId || "—"} / ${t.issueSlug}: ${t.intent.slice(0, 60)}`,
  ) || [];

  const lines = [
    `MatterFrame  [${frame.resolutionStatus}]`,
    "Primary:",
    ...(primary.length ? primary.map((p) => `  ${p.slug} ${p.confidence} — ${p.reason}`) : ["  (none)"]),
    secondary.length ? "Secondary:" : "",
    ...secondary.map((s) => `  ${s.slug} ${s.confidence}`),
    parties.length ? "Parties:" : "",
    ...parties.map((p) => `  ${p}`),
    relationships.length ? "Relationships:" : "",
    ...relationships.map((r) => `  ${r}`),
    capacities.length ? "Capacities:" : "",
    ...capacities.map((c) => `  ${c}`),
    events.length ? "Events:" : "",
    ...events.map((e) => `  ${e}`),
    eventIssueLinks.length ? "Event → issue:" : "",
    ...eventIssueLinks.map((l) => `  ${l}`),
    retrievalTraces.length ? "Retrieval plan:" : "",
    ...retrievalTraces.map((t) => `  ${t}`),
    frame.exclusions.length ? "Excluded:" : "",
    ...frame.exclusions.map((e) => `  ${e}`),
    frame.ambiguities.length ? "Ambiguities:" : "",
    ...frame.ambiguities.map(
      (a) => `  [${a.materiality}${a.blocking ? " blocking" : ""}] ${a.question}`,
    ),
    frame.retrievalScope.length ? "Retrieval scope:" : "",
    ...frame.retrievalScope.map((s) => `  ${s}`),
  ].filter(Boolean);

  return {
    matterId: frame.matterId,
    resolutionStatus: frame.resolutionStatus,
    primary,
    secondary,
    parties,
    relationships,
    capacities,
    events,
    eventIssueLinks,
    retrievalTraces,
    excluded: frame.exclusions,
    ambiguities: frame.ambiguities.map(
      (a) => `[${a.materiality}${a.blocking ? " blocking" : ""}] ${a.question}`,
    ),
    retrievalScope: frame.retrievalScope,
    overallConfidence: frame.overallConfidence,
    text: lines.join("\n"),
  };
}
