type IssueGraph = {
  primaryIssues: { slug: string }[];
  secondaryIssues: { slug: string }[];
  events: { type: string; disputed?: boolean }[];
  capacities?: { partyId: string; capacity: string }[];
};

function issueSlugSet(frame: IssueGraph): Set<string> {
  return new Set([
    ...frame.primaryIssues.map((i) => i.slug),
    ...frame.secondaryIssues.map((i) => i.slug),
  ]);
}

export function employmentIsBackdropOnly(frame: IssueGraph): boolean {
  const primary = frame.primaryIssues[0]?.slug === "employment";
  const secondary = frame.secondaryIssues.some((i) => i.slug === "employment");
  const disputed = frame.events.some((e) => e.type === "employment" && e.disputed);
  return secondary && !primary && !disputed;
}

/** Drop retrieve intents that belong to issues not on the frozen graph. */
export function intentAllowedOnGraph(intent: string, frame: IssueGraph): boolean {
  const t = intent.toLowerCase();
  const slugs = issueSlugSet(frame);
  if (/child arrangements|contact order|custody|pathfinder/.test(t) && !slugs.has("family")) {
    return false;
  }
  if (
    /discriminat|equality act|bullying|harassment at work/.test(t) &&
    !slugs.has("discrimination_equality")
  ) {
    return false;
  }
  if (
    frame.primaryIssues[0]?.slug !== "employment" &&
    /unfair dismiss|constructive dismiss|redundancy|working time|rest break|grievance|national minimum wage/.test(t)
  ) {
    return /holiday pay|unpaid wages|sick pay|ssp/.test(t);
  }
  if (/visa|indefinite leave|asylum/.test(t) && !slugs.has("immigration")) return false;
  if (
    /inheritance act|family provision|contesting a will|inheritance dispute/.test(t) &&
    !slugs.has("wills_probate") &&
    frame.primaryIssues[0]?.slug !== "family"
  ) {
    return false;
  }
  return true;
}

/** Drop wiki/research titles that are off the issue graph. */
export function titleAllowedOnGraph(title: string, frame: IssueGraph): boolean {
  const t = title.toLowerCase();
  const slugs = issueSlugSet(frame);
  if (/child arrangements|contact order|custody|pathfinder|child focussed/.test(t) && !slugs.has("family")) {
    return false;
  }
  if (
    /discriminat|equality act|protected characteristic|bullying at work|harassment at work/.test(t) &&
    !slugs.has("discrimination_equality")
  ) {
    return false;
  }
  if (
    frame.primaryIssues[0]?.slug !== "employment" &&
    /rest breaks|working time|working hours|value a claim for employment tribunal|unfair dismissal/.test(t)
  ) {
    return /holiday pay|wage|sick pay/.test(t);
  }
  if (/clinical negligence|medical negligence/.test(t) && frame.primaryIssues[0]?.slug !== "clinical_negligence") {
    return false;
  }
  if (frame.primaryIssues[0]?.slug === "housing" && !slugs.has("debt")) {
    if (/county court judgment|\bccj\b|enforce a (?:county |civil )?court judgment/i.test(t)) {
      return false;
    }
  }
  const userLandlord = frame.capacities?.some((c) => c.partyId === "user" && c.capacity === "landlord");
  const userTenant = frame.capacities?.some((c) => c.partyId === "user" && c.capacity === "tenant");
  if (userTenant && !userLandlord && /guide for landlords|can i evict my tenant|evict my tenant\?/i.test(t)) {
    return false;
  }
  if (/bailiff debt|debt relief|judgment debtor|creditors still contacting/i.test(t) && !slugs.has("debt")) {
    return false;
  }
  if (
    !slugs.has("wills_probate") &&
    /capital gains|inheritance tax|unused pension|gifting property|iht\b|probate and inheritance/i.test(t)
  ) {
    return false;
  }
  if (frame.primaryIssues[0]?.slug === "housing" && !slugs.has("conveyancing")) {
    if (/conveyancing|home insurance|cancelling policy/i.test(t)) return false;
  }
  return true;
}
