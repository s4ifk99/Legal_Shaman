/** Detect “problem with my solicitor/lawyer” matters for targeted signposting. */

export function isSolicitorComplaintStory(text: string): boolean {
  const t = (text || "").toLowerCase();
  if (!/\b(solicitor|lawyer|barrister|law firm|legal (?:aid )?advisor|legal adviser)\b/.test(t)) {
    return false;
  }
  return /\b(problem|complaint|complain|unhappy|poor service|negligen|missed|ignored|delay|delayed|stopped (?:replying|answering)|no response|fees?|bill|overcharg|dishonest|stole|steal|sra|ombudsman)\b/.test(
    t,
  );
}

export function solicitorComplaintSearchQuery(story: string): string {
  const short = story.replace(/\s+/g, " ").trim().slice(0, 280);
  return (
    `England Wales client unhappy with solicitor poor service complaint ` +
    `Legal Ombudsman SRA how to complain ${short}`
  );
}
