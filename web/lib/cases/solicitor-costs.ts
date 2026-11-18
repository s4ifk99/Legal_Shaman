import type { DisputeKind } from "@/lib/cases/dispute-context";
import type {
  ActionPlan,
  ActionPlanSolicitor,
  CaseProfileAnswers,
  FundingPreference,
} from "@/lib/cases/types";
import { COSTS_EMAIL } from "@/lib/site/contact-emails";

/** BCC so Legal Shaman can see published / quoted costs replies when clients use mailto. */
export const COST_REQUEST_BCC = COSTS_EMAIL;

export function serviceLabelForKind(kind?: DisputeKind | null): string {
  switch (kind) {
    case "divorce":
      return "family law / divorce";
    case "housing":
      return "housing / landlord-tenant";
    case "employment":
      return "employment";
    case "consumer":
      return "consumer / disputes";
    case "debt":
      return "debt recovery";
    case "neighbour":
      return "neighbour / civil disputes";
    case "benefits":
      return "welfare benefits";
    default:
      return "this legal matter";
  }
}

/**
 * SRA price-transparency rules require firms to publish prices for certain
 * reserved categories (conveyancing, probate, immigration, employment tribunal
 * unfair/wrongful dismissal, debt recovery, motoring). Family/divorce is not
 * on that mandatory list — firms may still publish voluntary fees.
 */
export function sraRequiresPublishedPrices(kind?: DisputeKind | null): boolean {
  switch (kind) {
    case "employment":
    case "debt":
      return true;
    default:
      return false;
  }
}

function cleanLine(value?: string | null): string | null {
  const v = (value || "").replace(/\s+/g, " ").trim();
  return v || null;
}

function legalAidLine(
  answers?: CaseProfileAnswers | null,
  fundingPreference?: FundingPreference | null,
): string {
  const likelihood = answers?.legalAidLikelihood;
  const summary = cleanLine(answers?.legalAidSummary);
  const pref = fundingPreference || null;

  if (pref === "legal_aid" || likelihood === "likely" || likelihood === "possible") {
    const base =
      likelihood === "likely"
        ? "Looking into legal aid (screen suggests it may be possible)"
        : likelihood === "possible"
          ? "May be eligible for legal aid — still needs a provider check"
          : "Interested in legal aid";
    return summary ? `${base}. ${summary}` : base;
  }
  if (likelihood === "unlikely" || pref === "private" || pref === "fixed_fee") {
    return summary
      ? `Not expecting legal aid / likely private pay. ${summary}`
      : "Not expecting legal aid — likely private pay or fixed fee";
  }
  if (summary) return `Legal aid status unclear. ${summary}`;
  return "Legal aid status not confirmed yet";
}

function pickDisputeField(
  da: Record<string, string> | undefined,
  keys: string[],
): string | null {
  if (!da) return null;
  for (const key of keys) {
    const hit = cleanLine(da[key]);
    if (hit) return hit;
  }
  // Loose match on key name
  for (const [key, value] of Object.entries(da)) {
    if (keys.some((k) => key.toLowerCase().includes(k.toLowerCase()))) {
      const hit = cleanLine(value);
      if (hit) return hit;
    }
  }
  return null;
}

function inferFromStory(story: string, needle: RegExp): boolean {
  return needle.test(story);
}

/**
 * Situation facts a solicitor needs to quote — not Legal Shaman plan steps.
 */
export function triageSummaryForCostRequest(input: {
  kind?: DisputeKind | null;
  story?: string | null;
  title?: string | null;
  plan?: ActionPlan | null;
  profileAnswers?: CaseProfileAnswers | null;
  fundingPreference?: FundingPreference | null;
  locationHint?: string | null;
}): string {
  const answers = input.profileAnswers || {};
  const da = answers.disputeAnswers || {};
  const service = serviceLabelForKind(input.kind);
  const story =
    cleanLine(answers.disputeStory) ||
    cleanLine(input.story) ||
    "I used Legal Shaman to summarise my situation.";
  const shortStory =
    story.length > 520 ? `${story.slice(0, 517).trim()}…` : story;

  const location =
    cleanLine(answers.solicitorLocation) ||
    cleanLine(input.locationHint) ||
    cleanLine(input.plan?.solicitorLocation) ||
    null;

  const children =
    pickDisputeField(da, [
      "divorce_children",
      "children",
      "child",
      "kids",
      "child_arrangements",
    ]) ||
    (inferFromStory(shortStory, /\b(child|children|kids?|son|daughter)\b/i)
      ? "Mentioned in my situation summary — details in the brief"
      : null);

  const assets =
    pickDisputeField(da, [
      "divorce_assets",
      "assets",
      "money",
      "property",
      "finances",
      "pension",
    ]) ||
    (inferFromStory(
      shortStory,
      /\b(house|home|property|mortgage|pension|savings?|assets?|finances?)\b/i,
    )
      ? "Money / property issues mentioned in my situation summary"
      : null);

  const safety =
    pickDisputeField(da, ["safety", "domestic", "abuse", "violence"]) ||
    (inferFromStory(shortStory, /\b(safety|abuse|violence|harass|threat)\b/i)
      ? "Safety concerns mentioned in my situation summary"
      : null);

  const shape =
    pickDisputeField(da, [
      "divorce_shape",
      "housing_shape",
      "employment_shape",
      "consumer_shape",
      "debt_shape",
      "neighbour_shape",
      "benefits_shape",
      "general_shape",
    ]) || null;

  const freeTried = cleanLine(answers.freeServicesTried);
  const speak = cleanLine(answers.wantSpeakToSomeone);
  const insurance = cleanLine(answers.insuranceCover);
  const openToPaying = cleanLine(answers.openToPaying);

  // Remaining dispute answers not already surfaced
  const usedKeys = new Set([
    "divorce_children",
    "divorce_assets",
    "divorce_shape",
    "housing_shape",
    "employment_shape",
    "consumer_shape",
    "debt_shape",
    "neighbour_shape",
    "benefits_shape",
    "general_shape",
    "children",
    "child",
    "kids",
    "child_arrangements",
    "assets",
    "money",
    "property",
    "finances",
    "pension",
    "safety",
    "domestic",
    "abuse",
    "violence",
  ]);
  const otherDetails: string[] = [];
  for (const [key, value] of Object.entries(da)) {
    if (usedKeys.has(key)) continue;
    const v = cleanLine(value);
    if (!v) continue;
    const label = key.replace(/_/g, " ");
    otherDetails.push(`${label}: ${v}`);
  }

  const factLines = [
    location ? `Location: ${location}` : null,
    `Legal aid: ${legalAidLine(answers, input.fundingPreference)}`,
    children ? `Children: ${children}` : null,
    assets ? `Assets / money / property: ${assets}` : null,
    safety ? `Safety: ${safety}` : null,
    shape ? `What matters most: ${shape}` : null,
    freeTried ? `Free advice already tried: ${freeTried}` : null,
    insurance ? `Insurance / union cover: ${insurance}` : null,
    openToPaying ? `Open to paying: ${openToPaying}` : null,
    speak ? `Want to speak to someone: ${speak}` : null,
    ...otherDetails.map((d) => d),
  ].filter((x): x is string => Boolean(x));

  const lines = [
    `Matter type: ${service}`,
    "",
    "My situation:",
    shortStory,
    "",
    "Details that may help you triage / quote:",
    ...factLines.map((f) => `• ${f}`),
  ];

  if (factLines.length <= 1) {
    lines.push(
      "• Further detail is limited in chat so far — happy to answer questions or send the PDF brief.",
    );
  }

  return lines.join("\n");
}

export function buildCostRequestEmail(input: {
  firm: ActionPlanSolicitor;
  kind?: DisputeKind | null;
  story?: string | null;
  title?: string | null;
  plan?: ActionPlan | null;
  profileAnswers?: CaseProfileAnswers | null;
  fundingPreference?: FundingPreference | null;
  locationHint?: string | null;
  clientName?: string | null;
}): { mailtoUrl: string; subject: string; body: string } {
  const service = serviceLabelForKind(input.kind);
  const subject = `Request for costs — ${service}`;
  const triage = triageSummaryForCostRequest(input);
  const who = input.clientName?.trim() || "A prospective client";
  const body = [
    `Dear ${input.firm.name},`,
    "",
    `I am writing to ask whether you can share your costs for ${service} work.`,
    "",
    "I used Legal Shaman (legalshaman.com) to organise my situation. Below is a short factual summary so you can triage the matter — not a formal instruction.",
    "",
    triage,
    "",
    "Could you please reply with:",
    `• typical or fixed fees for ${service} of this kind (and what is included)`,
    "• any hourly rates, disbursements, or court fees I should expect",
    "• whether you offer legal aid for this work, if relevant",
    "• how to book an initial conversation",
    "",
    "I have also prepared a short PDF brief from Legal Shaman that I can attach if helpful.",
    "",
    "Thank you for your time.",
    "",
    `Kind regards,`,
    who,
  ].join("\n");

  const params = new URLSearchParams();
  params.set("subject", subject);
  params.set("body", body);
  params.set("bcc", COST_REQUEST_BCC);

  const to = (input.firm.email || "").trim();
  const mailtoUrl = to ? `mailto:${to}?${params.toString()}` : `mailto:?${params.toString()}`;

  return { mailtoUrl, subject, body };
}
