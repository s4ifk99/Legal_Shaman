/**
 * Live dispute compiler for Third Eye / wiki slots.
 * Taxonomy slug is routing metadata. This object writes the research program:
 * open query, forums, offline topics, and first-class negatives.
 */

import { liveAskFromStory } from "@/lib/coherence/clientQuestions";

export type LiveDisputeKind =
  | "neighbour_surveillance"
  | "police_vehicle_claim"
  | "solicitor_conduct";

export type LiveDispute = {
  kind: LiveDisputeKind;
  label: string;
  utterance: string;
  officialOrgs: string;
  openQuery: string;
  helpFreeQuery: string;
  helpPaidQuery: string;
  topicKeys: string[];
  topicAllow: RegExp;
  negativeTitle: RegExp;
  suppressSlugPlaybook: boolean;
  briefConstraint: string;
};

function utteranceOf(story: string, max = 180): string {
  return story.replace(/\s+/g, " ").trim().slice(0, max);
}

export function resolveLiveDispute(story: string, clientQuestion = ""): LiveDispute | null {
  const ask = liveAskFromStory(story, clientQuestion);
  const utterance = utteranceOf(`${clientQuestion} ${story}`.trim());

  if (ask.solicitorConduct) {
    return {
      kind: "solicitor_conduct",
      label: "complaint about solicitors / Legal Ombudsman / SRA",
      utterance,
      officialOrgs: "Legal Ombudsman SRA GOV.UK Citizens Advice",
      openQuery: `${utterance} England complain solicitor Legal Ombudsman SRA GOV.UK Citizens Advice`.slice(0, 400),
      helpFreeQuery: `${utterance} England Legal Ombudsman SRA free advice Citizens Advice`.slice(0, 400),
      helpPaidQuery: `England find a solicitor SRA register Law Society regulated directory`.slice(0, 400),
      topicKeys: [],
      topicAllow: /ombudsman|sra|solicitor|legal.aid/i,
      negativeTitle: /holiday pay rights|getting paid when you leave|unfair dismissal|schedule of loss|rights at work/i,
      suppressSlugPlaybook: false,
      briefConstraint:
        "Operative dispute: complaint about the client's solicitors. Do not research employment rights or holiday pay unless the live ask is withheld wages.",
    };
  }

  if (ask.policeVehicleClaim) {
    return {
      kind: "police_vehicle_claim",
      label: "claim against police for damage to a parked vehicle",
      utterance,
      officialOrgs: "GOV.UK Citizens Advice legislation",
      openQuery: `${utterance} claim against police parked car damaged by police vehicle England official guidance GOV.UK Citizens Advice legislation`.slice(
        0,
        400,
      ),
      helpFreeQuery: `police vehicle damage claim England free advice helpline Citizens Advice law centre`.slice(0, 400),
      helpPaidQuery: `police civil claim vehicle damage England find a solicitor SRA Law Society regulated directory`.slice(
        0,
        400,
      ),
      topicKeys: [],
      topicAllow: /police|claim|vehicle|insurance|iopc/i,
      negativeTitle:
        /problem with a car repair|buying or repairing a car|poor workmanship|consumer standards code of practice|section\s*21|illegal evict/i,
      suppressSlugPlaybook: true,
      briefConstraint:
        "Operative dispute: claim against the police for damaging a parked vehicle. Do not research garage workmanship, quotes, or repair bills unless the sources are about collision damage estimates.",
    };
  }

  if (ask.neighbourSurveillance) {
    return {
      kind: "neighbour_surveillance",
      label: "neighbour camera / CCTV pointing at the home",
      utterance,
      officialOrgs: "ICO GOV.UK Citizens Advice",
      openQuery: `${utterance} neighbour CCTV camera pointing at my door domestic CCTV privacy ICO England official guidance ICO GOV.UK Citizens Advice legislation`.slice(
        0,
        400,
      ),
      helpFreeQuery: `neighbour CCTV privacy ICO complaint England free advice helpline Citizens Advice`.slice(0, 400),
      helpPaidQuery: `neighbour dispute privacy CCTV England find a solicitor SRA Law Society regulated directory`.slice(
        0,
        400,
      ),
      topicKeys: ["area-cctv-recording-privacy"],
      topicAllow: /cctv|privacy|ico|neighbour|harass|record|data.protect|data_protect/i,
      negativeTitle:
        /illegal evict|section\s*21|homelessness|housing and homelessness|eviction notice|private renting|renters.? rights act|notices of possession|tenant refuses to leave/i,
      suppressSlugPlaybook: true,
      briefConstraint:
        "Operative dispute: neighbour camera / CCTV pointing at the client's home. Research domestic CCTV, ICO complaints, and neighbour harassment. Do not research eviction, section 21, homelessness, or private renting unless the sources are about cameras.",
    };
  }

  return null;
}

export function titleBlockedByLiveDispute(title: string, story: string, clientQuestion = ""): boolean {
  const dispute = resolveLiveDispute(story, clientQuestion);
  if (!dispute) return false;
  return dispute.negativeTitle.test(title);
}
