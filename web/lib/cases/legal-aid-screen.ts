/**
 * Civil legal aid screening for England & Wales — built from GOV.UK means rules
 * (gross income ≤ £2,657/month, disposable income ≤ £733, capital ≤ £8,000;
 * passporting benefits for income). This is a triage aid, not a formal determination.
 */
import type { DisputeKind } from "@/lib/cases/dispute-context";
import {
  buildLegalAidMap,
  type LegalAidLikelihood,
} from "@/lib/cases/legal-aid-knowledge";

export type { LegalAidLikelihood };

export type LegalAidScreenId =
  | "scope"
  | "domestic_abuse"
  | "housing_risk"
  | "benefits"
  | "income"
  | "capital";

export type LegalAidQuestion = {
  id: LegalAidScreenId;
  ask: string;
  placeholder: string;
};

export type LegalAidScreenResult = {
  likelihood: LegalAidLikelihood;
  summary: string;
  notes: string[];
};

const PASSPORTING =
  /\b(universal credit|\buc\b|income support|income[- ]based jsa|income[- ]related esa|guarantee credit|pension credit)\b/i;

/** Problem types civil legal aid often covers (plain English). */
export function scopeHintForKind(kind: DisputeKind | null): string {
  return buildLegalAidMap({ kind }).headline;
}

export function legalAidQuestionsFor(
  kind: DisputeKind | null,
): LegalAidQuestion[] {
  const map = buildLegalAidMap({ kind });
  const inScopeTitles = map.scopeDoors
    .filter((d) => d.band === "often" || d.band === "sometimes")
    .map((d) => d.title)
    .slice(0, 3)
    .join("; ");

  const qs: LegalAidQuestion[] = [
    {
      id: "scope",
      ask:
        `${map.headline} ` +
        (inScopeTitles
          ? `In-scope doors often include: ${inScopeTitles}. `
          : "") +
        `${map.outOfScopeNote} Does your situation sound in scope, out of scope, or not sure? Tap the mic if speaking is easier.`,
      placeholder: "In scope / out of scope / not sure",
    },
  ];

  if (kind === "housing" || kind === "debt" || kind === "general" || kind === "benefits") {
    qs.push({
      id: "housing_risk",
      ask:
        kind === "benefits"
          ? "Has this Universal Credit problem put your home at risk — rent unpaid, eviction, or homelessness — or not? Housing risk can open a separate legal aid door. Tap the mic if speaking is easier."
          : "Is your home at risk — eviction, homelessness, or a possession hearing — or not? Housing risk is one of the strongest legal aid doors. Tap the mic if speaking is easier.",
      placeholder: "Yes home at risk / no / unsure",
    });
  }

  if (kind === "divorce" || kind === "general" || kind === "neighbour" || kind === "housing") {
    qs.push({
      id: "domestic_abuse",
      ask:
        "Is there domestic abuse, controlling behaviour, or a protection order involved — or are you unsure? This can open family legal aid even when divorce alone would not. Tap the mic if speaking is easier.",
      placeholder: "Yes / no / unsure",
    });
  }

  // For kinds almost never in scope, still ask means briefly so the map is complete —
  // but keep the set short when educate_then_skip_ok.
  const meansQs: LegalAidQuestion[] = [
    {
      id: "benefits",
      ask:
        "Do you (or your partner, if you live together and they are not on the other side of the case) get Universal Credit, Income Support, income-based JSA, income-related ESA, or Guarantee Credit of Pension Credit? Tap the mic if speaking is easier.",
      placeholder: "Yes / no / unsure",
    },
    {
      id: "income",
      ask:
        "Roughly, is your household monthly income before tax £2,657 or less (add about £222 for a fifth child and each further child)? Partner income usually counts unless they are the other side. Tap the mic if speaking is easier.",
      placeholder: "Under £2,657 / over / unsure",
    },
    {
      id: "capital",
      ask:
        "Aside from your main home in many cases, are your savings and other capital roughly £8,000 or less? (Immigration controlled work can use a lower £3,000 cap.) Tap the mic if speaking is easier.",
      placeholder: "Under £8,000 / over / unsure",
    },
  ];

  if (map.screenPriority === "educate_then_skip_ok") {
    // One means gate is enough when scope is almost never — full set if they say in scope later still ok via all answers stored.
    qs.push(meansQs[0]!);
  } else {
    qs.push(...meansQs);
  }

  return qs;
}

function yn(text: string): "yes" | "no" | "unsure" {
  const t = text.toLowerCase();
  if (PASSPORTING.test(t) || /\b(yes|yeah|yep|under|below|less than|i get|we get)\b/.test(t)) {
    return "yes";
  }
  if (/\b(no|nope|over|above|more than|earn too|too much)\b/.test(t)) return "no";
  return "unsure";
}

export function scoreLegalAidScreen(input: {
  kind: DisputeKind | null;
  answers: Record<string, string>;
}): LegalAidScreenResult {
  const notes: string[] = [];
  const kindMap = buildLegalAidMap({ kind: input.kind });
  const scope = yn(input.answers.scope || "");
  const da = yn(input.answers.domestic_abuse || "");
  const housingRisk = yn(input.answers.housing_risk || "");
  const benefits = yn(input.answers.benefits || "");
  const income = yn(input.answers.income || "");
  const capital = yn(input.answers.capital || "");

  let scopeOk = scope === "yes";
  if (input.kind === "employment" || input.kind === "consumer") {
    scopeOk = scope === "yes";
    if (scope !== "yes") {
      notes.push(kindMap.outOfScopeNote);
    }
  } else if (input.kind === "housing") {
    scopeOk = scope === "yes" || scope === "unsure" || housingRisk === "yes";
    if (housingRisk === "yes") notes.push("Home-at-risk facts strengthen the housing legal aid door.");
  } else if (input.kind === "divorce" && da === "yes") {
    scopeOk = true;
    notes.push("Domestic abuse evidence can open family legal aid routes.");
  } else if ((input.kind === "neighbour" || input.kind === "general") && (da === "yes" || housingRisk === "yes")) {
    scopeOk = true;
    if (da === "yes") notes.push("Abuse / protection facts can open family legal aid even if the neighbour label alone would not.");
    if (housingRisk === "yes") notes.push("Housing-risk overlap can open housing legal aid routes.");
  } else if (input.kind === "debt" && housingRisk === "yes") {
    scopeOk = true;
    notes.push("Debt linked to housing risk is more relevant for legal aid than general over-indebtedness.");
  } else if (input.kind === "benefits" && housingRisk === "yes") {
    scopeOk = true;
    notes.push(
      "UC problems that tip into homelessness or possession can open housing legal aid separately from the benefits appeal itself.",
    );
  }

  if (kindMap.screenPriority === "educate_then_skip_ok" && scope !== "yes" && da !== "yes" && housingRisk !== "yes") {
    scopeOk = false;
    notes.push(kindMap.outOfScopeNote);
  }

  if (scope === "unsure") notes.push("Problem-type fit still needs a provider check.");

  const incomeOk =
    benefits === "yes" ||
    income === "yes" ||
    (benefits === "unsure" && income !== "no") ||
    // Short screen for out-of-scope kinds may only ask benefits
    (income === "unsure" && benefits !== "no" && !input.answers.income);
  if (benefits === "yes") {
    notes.push("Passporting benefit usually passes the income test; capital still matters.");
  }
  if (income === "no" && benefits !== "yes") {
    notes.push("Income looks above the usual gross monthly limit.");
  }

  const capitalOk = capital !== "no";
  if (capital === "no") notes.push("Capital above £8,000 usually blocks civil legal aid.");
  if (capital === "unsure") notes.push("Capital still needs a precise check.");
  if (!input.answers.capital && kindMap.screenPriority === "educate_then_skip_ok") {
    notes.push("Full capital check skipped on this short screen — a provider still needs exact figures if scope opens.");
  }

  let likelihood: LegalAidLikelihood = "unsure";
  if (
    scopeOk &&
    incomeOk &&
    capitalOk &&
    (scope === "yes" || da === "yes" || housingRisk === "yes") &&
    (benefits === "yes" || income === "yes") &&
    (capital === "yes" || !input.answers.capital)
  ) {
    likelihood = input.answers.capital ? "likely" : "possible";
  } else if (!scopeOk || capital === "no" || (income === "no" && benefits === "no")) {
    likelihood = "unlikely";
  } else if (scopeOk && (incomeOk || capitalOk)) {
    likelihood = "possible";
  }

  // Kind prior: employment/consumer default unlikely unless they asserted scope + means.
  if (
    kindMap.likelihoodFromKindAlone === "unlikely" &&
    scope !== "yes" &&
    da !== "yes" &&
    housingRisk !== "yes"
  ) {
    likelihood = "unlikely";
  }

  const summary =
    likelihood === "likely"
      ? "From what you’ve said, legal aid looks plausible — a legal-aid provider should still confirm means and merits."
      : likelihood === "possible"
        ? "Legal aid may be possible. A provider needs to confirm scope, means, and merits."
        : likelihood === "unlikely"
          ? "Legal aid looks unlikely from these answers — free advice and other funding paths still matter."
          : "We can’t tell yet — keep free advice open while a provider checks eligibility.";

  return { likelihood, summary, notes };
}

export function legalAidIntroNeverHeard(kind?: DisputeKind | null): string {
  const map = buildLegalAidMap({ kind: kind || null });
  return (
    "Legal aid is government funding for certain civil problems in England and Wales if you qualify on the type of problem (scope), your means, and the strength of the case (merits). " +
    `${map.headline} ` +
    "I can ask a few short screening questions using GOV.UK means rules — not a formal decision. Say “okay” to check, or “skip” for free services and other financing. Tap the mic if speaking is easier."
  );
}

export function legalAidIntroHeard(kind?: DisputeKind | null): string {
  const map = buildLegalAidMap({ kind: kind || null });
  return (
    `Quick legal aid screen for this claim — ${map.scopeBand.replaceAll("_", " ")} for scope. ` +
    "We’ll check problem type, then benefits/income/savings where needed. Say “skip” any time. Tap the mic if speaking is easier."
  );
}
