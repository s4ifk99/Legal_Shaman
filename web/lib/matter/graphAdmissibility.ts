/**
 * Shared geometry check: a source is admissible only if it can sit on the
 * frozen MatterFrame (issues, capacities, live questions) — not because it
 * ranked next to a neighbour wiki attractor.
 */
import { titleAllowedOnGraph } from "./issueGraphHits";
import { coverageSlotsFrom, titleCoversGraph } from "./coverageSlots";

type IssueGraph = {
  primaryIssues: { slug: string }[];
  secondaryIssues: { slug: string }[];
  events?: { type: string; disputed?: boolean }[];
  capacities?: { partyId: string; capacity: string }[];
  exclusions?: string[];
};

function slugSet(frame: IssueGraph): Set<string> {
  return new Set([
    ...frame.primaryIssues.map((i) => i.slug),
    ...frame.secondaryIssues.map((i) => i.slug),
  ]);
}

export function storyLooksMotoringCrime(story: string): boolean {
  return /\b(pcn|penalty charge|driving ban|disqualif|speeding|drink.?driv|motoring|road traffic|dvla|licence points|driving (?:offence|offence))\b/i.test(
    story,
  );
}

export function storyLooksEmployerSeizedKit(story: string): boolean {
  return (
    /\b(work laptop|company laptop|employer(?:'s)? (?:work )?laptop|work (?:computer|pc|phone)|dropbox)\b/i.test(
      story,
    ) && /\b(police|seized|took|confiscat)\b/i.test(story)
  );
}

/** Titles that routinely leak onto the wrong matter because they rank well. */
export function isNeighbourAttractorTitle(title: string, frame: IssueGraph, story = ""): boolean {
  const t = title.toLowerCase();
  const slugs = slugSet(frame);
  const primary = frame.primaryIssues[0]?.slug || "";
  const housing = primary === "housing" || slugs.has("housing");
  const neighbour = slugs.has("neighbour_dispute");
  const family = slugs.has("family");
  const parking = slugs.has("parking_pcn") || storyLooksMotoringCrime(story);

  if (/right of way|easement|back garden|using a (?:back )?garden/i.test(t) && !neighbour) {
    return true;
  }
  if (/package holiday|holiday claim|abta\b/i.test(t) && !/holiday|travel agent|abta/i.test(story)) {
    return true;
  }
  if (/smart meter/i.test(t) && !/smart meter/i.test(story)) return true;
  if (/scam refund|authorised push payment/i.test(t) && !/scam|refund|app fraud/i.test(story)) {
    return true;
  }
  if (
    /tenancy deposit|deposit protection|tenancy deposits/i.test(t) &&
    (!housing || !/deposit/i.test(story))
  ) {
    return true;
  }
  if (
    /family court backlog|non-molestation|child arrangements|contact order/i.test(t) &&
    !family
  ) {
    return true;
  }
  if (/parking ticket|penalty charge|\bpcn\b|driving ban|motoring/i.test(t) && !parking) {
    return true;
  }
  if (/used car bought|repairing a car|problem with a car/i.test(t) && primary !== "consumer_vehicle_repair") {
    return true;
  }
  if (
    storyLooksEmployerSeizedKit(story) &&
    /illegal evict|homelessness|section\s*21|tenancy|shelter housing|right of way|garden/i.test(t)
  ) {
    return true;
  }
  return false;
}

export function titleAdmissibleOnGeometry(
  title: string,
  frame: IssueGraph,
  story = "",
  opts?: { requireCoverage?: boolean },
): boolean {
  if (!titleAllowedOnGraph(title, frame)) return false;
  if (isNeighbourAttractorTitle(title, frame, story)) return false;
  if (opts?.requireCoverage) {
    const slots = coverageSlotsFrom(frame, story);
    if (slots.length && !titleCoversGraph(title, slots, story)) return false;
  }
  return true;
}

export function filterAdmissibleTitles<T extends { title: string }>(
  items: T[],
  frame: IssueGraph,
  story = "",
  opts?: { requireCoverage?: boolean },
): T[] {
  return items.filter((item) => titleAdmissibleOnGeometry(item.title, frame, story, opts));
}

export function graphIsWeakForHits(
  titles: string[],
  frame: IssueGraph,
  story = "",
): boolean {
  const admitted = titles.filter((t) => titleAdmissibleOnGeometry(t, frame, story, { requireCoverage: true }));
  return admitted.length < 2;
}

export function overviewUsesForbiddenPlaybook(text: string, frame: IssueGraph, story = ""): boolean {
  const slugs = slugSet(frame);
  const housing = frame.primaryIssues[0]?.slug === "housing" || slugs.has("housing");
  const blob = text.toLowerCase();
  if (!housing && /matched housing guidance|use the matched housing/i.test(blob)) return true;
  if (!slugs.has("neighbour_dispute") && /right of way|back garden/i.test(blob)) return true;
  if (storyLooksEmployerSeizedKit(story) && /illegal evict|court-appointed bailiff|homelessness duty/i.test(blob)) {
    return true;
  }
  if (
    storyLooksEmployerSeizedKit(story) &&
    /\bdefendant\b/i.test(blob) &&
    /you (?:are|were) (?:the )?defendant|treat you as (?:the )?defendant/i.test(blob)
  ) {
    return true;
  }
  return false;
}
