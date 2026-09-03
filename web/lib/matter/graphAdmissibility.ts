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
  const s = story || "";
  const policeTookKit = /\b(police|cops|seized|confiscat|took)\b/i.test(s) &&
    /\b(laptop|computer|phone|dropbox|work files)\b/i.test(s);
  if (!policeTookKit) return false;
  return (
    /\b(work laptop|company laptop|employer(?:'s)? (?:work )?laptop|work (?:computer|pc|phone)|belongs to the business|my laptop.{0,40}work laptop|staff (?:member|has been)|member of my staff)\b/i.test(
      s,
    ) || /\b(company files|work files|employer(?:'s)? (?:property|kit|equipment))\b/i.test(s)
  );
}

/** First-person arrest without employer-kit language — the asker is likely the suspect. */
export function storyLooksAskerIsArrested(story: string): boolean {
  if (storyLooksEmployerSeizedKit(story)) return false;
  return /\b(i (?:was|have been|got) arrested|i(?:'m| am) (?:in custody|under arrest)|they arrested me)\b/i.test(
    story,
  );
}

/** Arrest + seized device, but not clearly whose kit / whose case. */
export function storyLooksAmbiguousSeizedDevice(story: string): boolean {
  const s = story || "";
  if (storyLooksEmployerSeizedKit(s) || storyLooksAskerIsArrested(s)) return false;
  return /\b(arrest|arrested)\b/i.test(s) && /\b(laptop|computer|phone|dropbox)\b/i.test(s);
}

const WRONG_PARTY_DEFENDANT_TITLE =
  /interview under caution|duty solicitor|you(?:'ve| have) given a witness statement|if you report child abuse|reporting a hate crime|hate incident|powers of entry|enter and search your property|search your (?:home|property|house)/i;

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
  if (
    /scam refund|authorised push payment|money back after a scam|something you ordered hasn|hasn.?t arrived|faulty goods|consumer helpline/i.test(
      t,
    ) &&
    !/scam|refund|app fraud|parcel|courier|ordered hasn|faulty goods/i.test(story)
  ) {
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
  if (storyLooksEmployerSeizedKit(story) && WRONG_PARTY_DEFENDANT_TITLE.test(t)) {
    return true;
  }
  if (
    storyLooksEmployerSeizedKit(story) &&
    /scam|hasn.?t arrived|ordered hasn|money back after|faulty goods|consumer helpline|package holiday/i.test(t)
  ) {
    return true;
  }
  return false;
}

/** Charities / helplines must match capacity, not just matter=crime. */
export function freeHelpAdmissibleOnGeometry(title: string, blurb: string, story = ""): boolean {
  const hay = `${title} ${blurb}`.toLowerCase();
  if (storyLooksEmployerSeizedKit(story)) {
    if (/homeless|nowhere to stay|emergency helpline|shelter england#|our free helpline - shelter/i.test(hay)) {
      return false;
    }
    if (/consumer helpline|faulty goods|refunds, traders|consumer rights/i.test(hay)) {
      return false;
    }
    if (/civil legal advice|legal aid gateway|housing, debt, family/i.test(hay)) {
      return false;
    }
    if (/magistrates.? court fines|going to court without a solicitor|you(?:'ve| have) been arrested|duty solicitor|legal aid.{0,40}police station/i.test(hay) &&
      !/property when you leave|leave a job|company property|work (?:laptop|files)|employer/i.test(hay)) {
      return false;
    }
  }
  return true;
}

/** Prosecutors and similar orgs must not appear as criminal-defence matches. */
export function sraOrganisationAdmissible(name: string): boolean {
  return !/crown prosecution service|\bcps\b|crown office and procurator|serious fraud office/i.test(
    name || "",
  );
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
  if (storyLooksEmployerSeizedKit(story) && /progress the .{0,40} using the matched guidance/i.test(blob)) {
    return true;
  }
  if (storyLooksEmployerSeizedKit(story) && WRONG_PARTY_DEFENDANT_TITLE.test(blob)) {
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
