import type { MatterFrame } from "./types";

function slugSet(frame: MatterFrame): Set<string> {
  return new Set([
    ...frame.primaryIssues.map((i) => i.slug),
    ...frame.secondaryIssues.map((i) => i.slug),
  ]);
}

/** Extra wiki queries when the frozen graph is not yet covered by hit titles. */
export function gapIntentsForFrame(
  frame: MatterFrame,
  story: string,
  hitTitles: string[],
): string[] {
  const blob = hitTitles.join(" ").toLowerCase();
  const slugs = slugSet(frame);
  const out: string[] = [];
  if (slugs.has("housing") && !/illegal evict/.test(blob)) {
    out.push("illegal eviction lock out without court order");
  }
  if (slugs.has("housing") && !/homeless/.test(blob)) {
    out.push("homelessness help local authority Shelter");
  }
  if (
    (slugs.has("housing") || /no tenancy|occupier|tied/i.test(story)) &&
    !/occup|tied accommodation|no tenancy|landlord & tenant/.test(blob)
  ) {
    out.push("occupier no written tenancy service occupancy");
  }
  if (slugs.has("employment") && /wage|holiday pay|sick pay|ssp/i.test(story) && !/holiday pay|unpaid wage|acas/.test(blob)) {
    out.push("unpaid wages holiday pay ACAS");
  }
  return [...new Set(out)];
}
