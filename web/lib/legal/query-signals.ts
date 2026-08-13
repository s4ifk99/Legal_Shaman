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
 * Council / London Tribunals PCN (permit road, bus lane, moving traffic) —
 * not employment just because the story starts “someone at my work”.
 */
export function isPcnAppealQuery(query: string): boolean {
  const q = query.toLowerCase();
  const pcn =
    /\bpcns?\b/i.test(q) ||
    /\bpenalty charge( notices?)?\b/i.test(q) ||
    /\b(parking ticket|parking fine|parking charge notice)\b/i.test(q);
  if (!pcn) return false;
  // Workplace HR stories that happen to say “PCN” as something else are rare;
  // still require a traffic / council cue when the only hit is a weak “ticket”.
  return (
    /\b(council|hounslow|tf[l]|london tribunal|london tribunals|eta\b|adjudicat|permit|restricted (road|hours)|bus lane|moving traffic|contravention|yellow box|congestion charge|appeal)\b/i.test(
      q,
    ) || /\bpcns?\b/i.test(q)
  );
}
