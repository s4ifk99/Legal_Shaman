import type { MatterFrame } from "@/lib/matter/types";
import { formatCaseBrief, liveSituation } from "@/lib/coherence/caseBuilder";
import { liveAskFromStory } from "@/lib/coherence/clientQuestions";
import { coverageSlotsFrom, type CoverageSlot } from "@/lib/matter/coverageSlots";

export type ExaSearchScope = "open" | "allowlist";

export type ExaResearchQuery = {
  id: string;
  query: string;
  scope: ExaSearchScope;
};

/** Natural-language brief plus per-slot Exa queries on the frozen case file. */
export function buildExaResearchBrief(opts: {
  story: string;
  frame: MatterFrame;
  clientQuestion?: string;
}): { brief: string; queries: ExaResearchQuery[]; slots: CoverageSlot[] } {
  const { story, frame, clientQuestion } = opts;
  const ask = liveAskFromStory(story, clientQuestion);
  const primary = frame.primaryIssues[0]?.slug?.replace(/_/g, " ") || "uncertain";
  const secondary = frame.secondaryIssues
    .slice(0, 3)
    .map((i) => i.slug.replace(/_/g, " "))
    .join(", ");
  const exclusions = (frame.exclusions || []).slice(0, 6).join(", ");
  const live = liveSituation(story, frame);
  const caseFile = formatCaseBrief(frame, story, clientQuestion);
  const storySlice = story.replace(/\s+/g, " ").trim().slice(0, 1600);
  const slots = coverageSlotsFrom(frame, story);

  const brief = [
    "UK legal research brief for England and Wales.",
    `Research this client's situation from scratch. Primary area of law: ${primary}.`,
    secondary ? `Also in play: ${secondary}.` : "",
    `Live situation: ${live}.`,
    ask.policeVehicleClaim
      ? "Operative dispute: claim against the police for damaging a parked vehicle. Do not research garage workmanship, quotes, or repair bills unless the sources are about collision damage estimates."
      : "",
    exclusions
      ? `Do not treat this as ${exclusions.replace(/_/g, " ")} unless the sources clearly support it.`
      : "",
    clientQuestion ? `Client questions: ${clientQuestion}` : "",
    slots.length
      ? `Cover these issue slots: ${slots.map((s) => s.label).join("; ")}.`
      : "Find official and trusted public sources: statutes, GOV.UK, Shelter, Citizens Advice, ACAS.",
    `Facts:\n${storySlice}`,
    caseFile,
  ]
    .filter(Boolean)
    .join("\n\n");

  const slotQueries: ExaResearchQuery[] = slots.slice(0, 3).map((slot) => ({
    id: slot.id,
    query: slot.exaQuery.slice(0, 400),
    scope: "allowlist" as const,
  }));
  const openFocus = slots
    .slice(0, 2)
    .map((s) => s.label)
    .join("; ");
  const openPrimary = ask.policeVehicleClaim
    ? `claim against police parked car damaged by police vehicle. ${openFocus || live}. England official guidance GOV.UK Citizens Advice legislation.`
    : `${primary}. ${openFocus || live}. England official guidance Shelter GOV.UK legislation.`;
  const queries: ExaResearchQuery[] = [
    {
      id: "open-primary",
      query: openPrimary.slice(0, 400),
      scope: "open",
    },
    ...slotQueries,
    {
      id: "help-free",
      query: `${ask.policeVehicleClaim ? "police vehicle damage claim" : primary} ${live} England free advice helpline Citizens Advice law centre legal aid get help contact`.slice(
        0,
        400,
      ),
      scope: "open",
    },
    {
      id: "help-paid",
      query: `${ask.policeVehicleClaim ? "police civil claim vehicle damage" : primary} England find a solicitor SRA register Law Society find a solicitor regulated directory`.slice(
        0,
        400,
      ),
      scope: "open",
    },
  ];
  if (!queries.some((q) => q.scope === "allowlist")) {
    queries.push({
      id: "official",
      query: `${primary} ${live} official UK guidance Shelter GOV.UK ACAS Citizens Advice`.slice(0, 400),
      scope: "allowlist",
    });
  }

  return { brief, queries, slots };
}

export function cacheMatterKey(frame: MatterFrame): string {
  const primary = frame.primaryIssues[0]?.slug || "unknown";
  const extra = frame.secondaryIssues
    .slice(0, 2)
    .map((i) => i.slug)
    .join("+");
  return extra ? `${primary}+${extra}` : primary;
}
