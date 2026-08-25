/** Shared query-shape detectors for wiki retrieve + taxonomy (leaf module). */

/** Garage / van / car repair — not landlord housing repairs, not employment. */
export function isVehicleRepairQuery(query: string): boolean {
  const q = query.toLowerCase();
  if (/\b(works?\s+van|company van|hire van|works vehicle)\b/i.test(q)) return true;
  if (/\b(mechanic|main dealer|motor ombudsman|mot)\b/i.test(q)) return true;
  if (/\bgarage\b/i.test(q)) {
    const neighbourOnly =
      /\b(neighbour|neighbor|extension|boundary|planning)\b/i.test(q) &&
      !/\b(repair|mechanic|mot|van|car|vehicle|charged|invoice)\b/i.test(q);
    if (!neighbourOnly) return true;
  }
  const vehicle = /\b(van|car|vehicle|motorbike|motorcycle)\b/i.test(q);
  const repairish =
    /\b(repair|repaired|garage|mechanic|expansion tank|coolant|engine|faulty|workmanship|poor (service|work)|charged)\b/i.test(
      q,
    );
  const bought = /\b(bought|purchased?|purchase)\b/i.test(q);
  return vehicle && (repairish || bought);
}

/** Filming / CCTV / consent — not “I have a record of the invoice”. */
export function isRecordingLawQuery(query: string): boolean {
  return /\b(film(ing)?|photograph|cctv|privacy|record(ing|ed)? (someone|me|without)|without .{0,20}consent|illegal to record)\b/i.test(
    query,
  );
}

/**
 * Flat / house purchase where an estate agent may have misrepresented material facts
 * (demolition, cladding, fees) — not travel agents, business agents, or used cars.
 */
export function isPropertyPurchaseMisrepresentationQuery(query: string): boolean {
  const q = query.toLowerCase();
  const propertyContext =
    /\b(flat|house|property|building|leasehold|freehold|apartment)\b/i.test(q) &&
    /\b(sale|buy|buying|purchase|listed|surveyor|conveyanc|demolition|cladding|service charge|management (company|fee|compant)|cash only|house sale)\b/i.test(
      q,
    );
  const estateAgent = /\bestate agent\b/i.test(q);
  const misrep =
    /\b(misrepresent|not listed|nowhere on|they said no|grounds to go after|complain)\b/i.test(q);
  return (
    (estateAgent && propertyContext) ||
    (propertyContext && misrep && /\b(surveyor|solicitor|conveyanc)\b/i.test(q))
  );
}

/**
 * Ex / co-parent damaged a child’s gift or belongings — civil recovery / small claims,
 * not child arrangements / custody (even though matter may still type as family).
 */
export function isFamilyBelongingsPropertyClaim(query: string): boolean {
  const q = (query || "").toLowerCase();
  if (!q.trim()) return false;
  // Pure custody / divorce / DA as the ask — keep family wiki path
  if (
    /\b(child arrangements?|contact order|custody|care order|divorce|non-molestation|domestic (?:abuse|violence))\b/i.test(
      q,
    ) &&
    !/\b(threw|broke|broken|damaged|destroyed|smashed|sue|replacement|switch|console|toy|gift|get (?:it|them) (?:back|fixed))\b/i.test(
      q,
    )
  ) {
    return false;
  }
  const damageOrSue =
    /\b(threw|broke|broken|damaged|destroyed|smashed|ruined)\b/.test(q) ||
    /\b(sue|get (?:it|them) (?:back|fixed)|can'?t afford a new|replacement|small claims?|money claim|letter before action)\b/.test(
      q,
    );
  if (!damageOrSue) return false;
  const familyBackdrop =
    /\b(my ex|ex[- ]?(?:partner|wife|husband)|his mum|his mom|her boyfriend|boyfriend'?s kid|co[- ]?parent)\b/.test(
      q,
    ) ||
    (/\b(\d+\s*year\s*old|my (?:sons?|daughters?|kids?|children|child)|picking .{0,12}(?:sons?|daughters?) up)\b/.test(
      q,
    ) &&
      /\b(ex|mum|mom|mother|dad|father|boyfriend)\b/.test(q));
  return familyBackdrop;
}

/**
 * Council / London Tribunals PCN (permit road, bus lane, moving traffic) —
 * not employment just because the story starts “someone at my work”.
 */
export function isPcnAppealQuery(query: string): boolean {
  const q = query.toLowerCase();
  if (/\bpopla\b/i.test(q) || /\bprivate (?:car\s*)?park/i.test(q)) return true;
  const pcn =
    /\bpcns?\b/i.test(q) ||
    /\bpenalty charge( notices?)?\b/i.test(q) ||
    /\b(parking ticket|parking fine|parking charge(?: notice)?)\b/i.test(q);
  if (!pcn) return false;
  return (
    /\b(council|hounslow|tf[l]|london tribunal|london tribunals|eta\b|adjudicat|permit|restricted (road|hours)|bus lane|moving traffic|contravention|yellow box|congestion charge|appeal|private parking|car park)\b/i.test(
      q,
    ) || /\bpcns?\b/i.test(q)
  );
}
