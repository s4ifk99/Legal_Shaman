/**
 * Universal Credit rights + entitlement/appeal triage for Ask the Shaman.
 * Finds the relevant rule, explains it in plain English, estimates likely/unlikely,
 * and points to the right next door. Triage only — not a DWP decision or legal advice.
 */
import type { DisputeKind } from "@/lib/cases/dispute-context";

export type UcClaimStage =
  | "new_claim"
  | "decision_challenge"
  | "mandatory_reconsideration"
  | "tribunal_appeal"
  | "sanction"
  | "overpayment"
  | "payment_problem"
  | "unsure";

export type UcLikelihood = "likely" | "possible" | "unlikely" | "unsure";

export type UcDoorBand = "do_now" | "usual_next" | "if_needed" | "rare";

export type UcProcessDoor = {
  id: string;
  title: string;
  band: UcDoorBand;
  summary: string;
  deadlineHint?: string;
  sourceUrl?: string;
};

export type UcHelpDoor = {
  id: string;
  name: string;
  blurb: string;
  url?: string;
  phone?: string;
};

/** A plain-English explanation of a UC rule / right, grounded in a public source. */
export type UcLawTopic = {
  id: string;
  title: string;
  /** What the rule/right is, in calm plain English */
  rightInPlainEnglish: string;
  /** What this usually means for the client’s next move */
  whatItMeansForYou: string;
  whenItApplies: string[];
  sourceUrl: string;
  sourceLabel: string;
};

export type UcScreenId =
  | "issue"
  | "decision_date"
  | "mr_done"
  | "work_health"
  | "housing_children"
  | "money_picture"
  | "good_reason";

export type UcScreenQuestion = {
  id: UcScreenId;
  ask: string;
  placeholder: string;
};

export type UcMapResult = {
  stage: UcClaimStage;
  headline: string;
  /** Selected law topics for this story / answers */
  lawTopics: UcLawTopic[];
  /** Short chat turns explaining rights (not one dump) */
  rightsMessages: string[];
  entitlementLikelihood: UcLikelihood;
  entitlementSummary: string;
  appealLikelihood: UcLikelihood;
  appealSummary: string;
  processDoors: UcProcessDoor[];
  helpDoors: UcHelpDoor[];
  evidenceTips: string[];
  financingNote: string;
  legalAidNote: string;
  nextSteps: string[];
  honestNote: string;
  checkUrl: string;
  appealUrl: string;
  eligibilityUrl: string;
};

const GOV_UC = "https://www.gov.uk/universal-credit";
const GOV_ELIGIBILITY = "https://www.gov.uk/universal-credit/eligibility";
const GOV_WHAT_YOULL_GET = "https://www.gov.uk/universal-credit/what-youll-get";
const GOV_MR = "https://www.gov.uk/mandatory-reconsideration";
const GOV_APPEAL = "https://www.gov.uk/appeal-benefit-decision";
const GOV_SANCTION =
  "https://www.gov.uk/government/publications/universal-credit-and-you/universal-credit-and-you-a#sanctions";
const GOV_HEALTH =
  "https://www.gov.uk/universal-credit/how-your-earnings-affect-your-payments"; // work capability pages linked from UC hub
const GOV_WORK_CAPABILITY =
  "https://www.gov.uk/health-conditions-disability-universal-credit";
const GOV_HOUSING = "https://www.gov.uk/universal-credit/what-youll-get";
const CA_UC = "https://www.citizensadvice.org.uk/benefits/universal-credit/";

export const UC_HELP_DOORS: UcHelpDoor[] = [
  {
    id: "citizens-advice-benefits",
    name: "Citizens Advice — Universal Credit",
    blurb: "Free help understanding eligibility, decisions, sanctions, and appeals.",
    url: CA_UC,
  },
  {
    id: "gov-eligibility",
    name: "GOV.UK — UC eligibility",
    blurb: "Official rules on who can claim Universal Credit.",
    url: GOV_ELIGIBILITY,
  },
  {
    id: "gov-challenge",
    name: "GOV.UK — Challenge a benefit decision",
    blurb: "Mandatory reconsideration and tribunal appeal steps.",
    url: GOV_APPEAL,
  },
  {
    id: "advicenow-benefits",
    name: "Advicenow — benefits guides",
    blurb: "Plain-English guides on reconsiderations and appeals.",
    url: "https://www.advicenow.org.uk/",
  },
  {
    id: "law-centres-benefits",
    name: "Law Centres Network",
    blurb: "Some law centres help with benefits appeals — availability varies by area.",
    url: "https://www.lawcentres.org.uk/",
  },
];

/** Core UC law topics the agent can explain. */
export const UC_LAW_TOPICS: UcLawTopic[] = [
  {
    id: "eligibility_basics",
    title: "Who Universal Credit is for",
    rightInPlainEnglish:
      "Universal Credit is a means-tested benefit for people of working age who are on a low income or out of work. You usually need to be in Great Britain, meet residence/immigration conditions, and accept claimant commitments (unless you’re exempt).",
    whatItMeansForYou:
      "If DWP say you’re not eligible, the fight is often about residence, age, education status, or whether another benefit applies — not just income.",
    whenItApplies: ["new_claim", "decision_challenge", "unsure"],
    sourceUrl: GOV_ELIGIBILITY,
    sourceLabel: "GOV.UK — Eligibility",
  },
  {
    id: "elements_amount",
    title: "What UC is made of (elements)",
    rightInPlainEnglish:
      "Your UC award is built from elements — a standard allowance, then extras that can include housing, children, childcare, and limited capability for work-related activity (LCWRA). Earnings and some other income reduce the award through the taper.",
    whatItMeansForYou:
      "If the amount looks wrong, name which element is missing or cut (housing, child, LCWRA, childcare) and gather proof for that element.",
    whenItApplies: ["decision_challenge", "payment_problem", "mandatory_reconsideration", "tribunal_appeal", "unsure"],
    sourceUrl: GOV_WHAT_YOULL_GET,
    sourceLabel: "GOV.UK — What you’ll get",
  },
  {
    id: "work_capability",
    title: "Health / limited capability for work",
    rightInPlainEnglish:
      "If illness or disability limits what you can do, you may be assessed for limited capability for work (LCW) or limited capability for work and work-related activity (LCWRA). LCWRA can add an extra element and change work-search expectations.",
    whatItMeansForYou:
      "Challenges often turn on medical evidence and whether the descriptors fit how your condition affects daily life — not only the diagnosis name.",
    whenItApplies: ["decision_challenge", "mandatory_reconsideration", "tribunal_appeal", "new_claim"],
    sourceUrl: GOV_WORK_CAPABILITY,
    sourceLabel: "GOV.UK — Health conditions and disability",
  },
  {
    id: "housing_element",
    title: "Housing costs element",
    rightInPlainEnglish:
      "If you pay rent, UC can include a housing element toward eligible rent (with caps and deductions, including for spare bedrooms in some cases). Owner-occupier housing costs are treated differently.",
    whatItMeansForYou:
      "Wrong housing payments often need a tenancy, rent proof, and who lives in the home. If rent shortfalls risk eviction, say so — housing help may sit alongside the UC challenge.",
    whenItApplies: ["decision_challenge", "payment_problem", "overpayment", "unsure"],
    sourceUrl: GOV_HOUSING,
    sourceLabel: "GOV.UK — What you’ll get",
  },
  {
    id: "challenge_rights",
    title: "Your right to challenge a decision",
    rightInPlainEnglish:
      "If you disagree with a UC decision, you usually ask for a mandatory reconsideration first. If you still disagree after the MR notice, you can normally appeal to an independent First-tier Tribunal. Deadlines are often about one month, though late challenges can sometimes be accepted with reasons.",
    whatItMeansForYou:
      "You do not need a solicitor to start. Keep the decision date, explain why DWP got it wrong, and attach evidence. Missing a deadline is serious — still ask and explain why you were late.",
    whenItApplies: [
      "decision_challenge",
      "mandatory_reconsideration",
      "tribunal_appeal",
      "sanction",
      "overpayment",
      "payment_problem",
      "unsure",
    ],
    sourceUrl: GOV_MR,
    sourceLabel: "GOV.UK — Mandatory reconsideration",
  },
  {
    id: "appeal_rights",
    title: "Tribunal appeal rights",
    rightInPlainEnglish:
      "After mandatory reconsideration, you can usually appeal to the Social Security and Child Support tribunal. The tribunal looks at whether the decision was correct on the law and facts — it is independent of DWP.",
    whatItMeansForYou:
      "Appeals are strongest when your evidence answers DWP’s written reasons. You can ask for a hearing. Free advice can help you prepare; this is not about ‘winning on vibe’.",
    whenItApplies: ["tribunal_appeal", "mandatory_reconsideration", "decision_challenge"],
    sourceUrl: GOV_APPEAL,
    sourceLabel: "GOV.UK — Appeal a benefit decision",
  },
  {
    id: "sanctions",
    title: "Sanctions and ‘good reason’",
    rightInPlainEnglish:
      "DWP can reduce or stop UC for a period if they decide you failed a work-related requirement without good reason. You can challenge the sanction decision and, if you’re in hardship, ask about a hardship payment.",
    whatItMeansForYou:
      "Explain why you could not do what was required (illness, caring, no notice, wrong appointment details). Evidence of good reason is often decisive.",
    whenItApplies: ["sanction"],
    sourceUrl: GOV_SANCTION,
    sourceLabel: "GOV.UK — Sanctions",
  },
  {
    id: "overpayments",
    title: "Overpayments and recovery",
    rightInPlainEnglish:
      "If DWP say you were paid too much, they may recover it from ongoing UC or otherwise. You can challenge whether there was an overpayment and, in some cases, how it is recovered — especially where DWP already had the correct information.",
    whatItMeansForYou:
      "Ask for a breakdown (period, amount, reason). Keep bank statements and journal messages. Hardship from recovery rates also matters practically.",
    whenItApplies: ["overpayment"],
    sourceUrl: GOV_UC,
    sourceLabel: "GOV.UK — Universal Credit",
  },
];

function yn(text: string): "yes" | "no" | "unsure" {
  const t = (text || "").toLowerCase();
  if (/\b(yes|yeah|yep|under|below|i (get|have|did)|we (get|have)|already|done|completed)\b/.test(t)) {
    return "yes";
  }
  if (/\b(no|nope|not yet|haven't|have not|none|over|above)\b/.test(t)) return "no";
  return "unsure";
}

export function detectUcStage(story: string, answers?: Record<string, string>): UcClaimStage {
  const issue = (answers?.issue || "").toLowerCase();
  const t = `${story} ${issue}`.toLowerCase();
  if (/\b(sanction|sanctioned|missed (an? )?appointment)\b/.test(t)) return "sanction";
  if (/\b(overpay|overpaid|recover(y|ing)? (the )?overpayment)\b/.test(t)) return "overpayment";
  if (/\b(tribunal|first[- ]tier|sscs|appeal (to|against))\b/.test(t)) return "tribunal_appeal";
  if (/\b(mandatory reconsideration|\bmr\b|look again|reconsider)\b/.test(t)) {
    return "mandatory_reconsideration";
  }
  if (/\b(lcw|lcwra|limited capability|work capability|fit for work|health assessment)\b/.test(t)) {
    return "decision_challenge";
  }
  if (/\b(decision|refused|turned down|wrong amount|housing element|childcare)\b/.test(t)) {
    return "decision_challenge";
  }
  if (/\b(not paid|missing payment|payment delayed|journal|advance)\b/.test(t)) {
    if (/\b(new claim|applied|applying|just claimed)\b/.test(t)) return "new_claim";
    return "payment_problem";
  }
  if (/\b(new claim|applied for uc|claiming uc|can i (get|claim))\b/.test(t)) return "new_claim";
  return "unsure";
}

export function ucScreenQuestionsFor(stage: UcClaimStage): UcScreenQuestion[] {
  const qs: UcScreenQuestion[] = [
    {
      id: "issue",
      ask:
        "In one line: is this about getting UC for the first time, a wrong or refused amount (housing/health/children), a sanction, an overpayment, or an appeal already underway? Tap the mic if speaking is easier.",
      placeholder: "New claim / wrong amount / sanction / overpayment / appeal…",
    },
  ];

  if (stage !== "new_claim") {
    qs.push({
      id: "decision_date",
      ask:
        "Do you have a written UC decision or journal notice with a date — and was it roughly within the last month, longer ago, or not sure? Deadlines often run from that date. Tap the mic if speaking is easier.",
      placeholder: "Within a month / longer / no date yet / unsure",
    });
    qs.push({
      id: "mr_done",
      ask:
        "Have you already asked for a mandatory reconsideration (DWP looking again), got an MR notice, or not yet? Tap the mic if speaking is easier.",
      placeholder: "Not yet / asked / got MR notice / unsure",
    });
  }

  if (stage === "sanction" || stage === "unsure") {
    qs.push({
      id: "good_reason",
      ask:
        "If this involves a sanction or missed requirement: did you have a good reason (illness, caring, no notice, wrong details) — or not sure? Tap the mic if speaking is easier.",
      placeholder: "Yes good reason / no / unsure / not a sanction",
    });
  }

  qs.push({
    id: "work_health",
    ask:
      "Are health or disability limits part of this — for example LCW, LCWRA, or a fit-for-work decision — or is this mainly about money, housing, children, or something else? Tap the mic if speaking is easier.",
    placeholder: "Health/LCWRA / housing / children / money only / unsure",
  });

  qs.push({
    id: "housing_children",
    ask:
      "Does this touch rent/housing costs or children/childcare elements — or neither? Tap the mic if speaking is easier.",
    placeholder: "Housing / children / both / neither",
  });

  if (stage === "new_claim" || stage === "unsure" || stage === "decision_challenge") {
    qs.push({
      id: "money_picture",
      ask:
        "Roughly: are you on a low income or out of work, with savings that are not high — or is money/capital the reason DWP refused you? A short answer is enough. Tap the mic if speaking is easier.",
      placeholder: "Low income / refused on money / capital issue / unsure",
    });
  }

  return qs.slice(0, 5);
}

function selectLawTopics(stage: UcClaimStage, story: string, answers: Record<string, string>): UcLawTopic[] {
  const hay = `${story} ${Object.values(answers).join(" ")}`.toLowerCase();
  const picked: UcLawTopic[] = [];
  const want = (id: string) => {
    const topic = UC_LAW_TOPICS.find((t) => t.id === id);
    if (topic && !picked.some((p) => p.id === id)) picked.push(topic);
  };

  want("challenge_rights");

  if (stage === "new_claim" || /\b(eligible|entitle|can i (get|claim)|first time)\b/.test(hay)) {
    want("eligibility_basics");
    want("elements_amount");
  }
  if (stage === "tribunal_appeal" || stage === "mandatory_reconsideration" || /\bappeal\b/.test(hay)) {
    want("appeal_rights");
  }
  if (stage === "sanction" || /\bsanction\b/.test(hay)) want("sanctions");
  if (stage === "overpayment" || /\boverpay\b/.test(hay)) want("overpayments");
  if (/\b(lcw|lcwra|health|disabilit|fit for work|work capability)\b/.test(hay)) {
    want("work_capability");
  }
  if (/\b(housing|rent|landlord|bedroom)\b/.test(hay)) want("housing_element");
  if (picked.length < 3) want("elements_amount");
  if (picked.length < 3) want("eligibility_basics");

  return picked.slice(0, 4);
}

function scoreEntitlement(input: {
  stage: UcClaimStage;
  story: string;
  answers: Record<string, string>;
}): { likelihood: UcLikelihood; summary: string } {
  const hay = `${input.story} ${Object.values(input.answers).join(" ")}`.toLowerCase();
  const money = (input.answers.money_picture || "").toLowerCase();
  const workHealth = (input.answers.work_health || "").toLowerCase();

  // Already on UC / challenging an award — entitlement to *claim* is largely established; focus shifts to elements.
  if (
    input.stage !== "new_claim" &&
    /\b(i (get|receive|am on|i'm on) (uc|universal credit)|my uc|uc payment|journal)\b/.test(hay)
  ) {
    return {
      likelihood: "likely",
      summary:
        "You already appear to be in the UC system — the live question is usually whether a particular element or decision is correct, not whether UC exists for people in your shoes.",
    };
  }

  if (/\b(no recourse|nrpf|student only|full[- ]time education|over state pension age)\b/.test(hay)) {
    return {
      likelihood: "unlikely",
      summary:
        "Some statuses (for example certain students, NRPF, or pension age routes) often sit outside ordinary UC — check GOV.UK eligibility and free advice before assuming a claim will succeed.",
    };
  }

  if (/\b(capital|savings).{0,20}(over|above|too (much|high)|16,?000)\b/.test(hay) || /\bover £?16/.test(money)) {
    return {
      likelihood: "unlikely",
      summary:
        "High capital can block or reduce UC. If DWP refused you on savings/capital, get free advice on the figures and whether any disregard might apply — do not treat this chat as a calculation.",
    };
  }

  if (
    /\b(low income|out of work|unemployed|on uc|universal credit)\b/.test(hay) ||
    /\blow income|out of work/.test(money)
  ) {
    if (/\b(health|lcw|lcwra|disabilit)\b/.test(workHealth) || /\b(rent|housing|children)\b/.test(hay)) {
      return {
        likelihood: "possible",
        summary:
          "From what you’ve said, a UC claim (or a higher award via housing/health/children elements) can be realistic — but eligibility and amounts still need DWP rules and evidence. Free advice can sense-check before you rely on it.",
      };
    }
    return {
      likelihood: "possible",
      summary:
        "Low income / out-of-work situations are the core UC territory. Whether *you* qualify still depends on residence, age, capital, and other rules — use GOV.UK eligibility and a free adviser for a firm view.",
    };
  }

  return {
    likelihood: "unsure",
    summary:
      "There isn’t enough yet to triage UC entitlement. The key facts are usually: where you live/immigration status, age, work/income, capital, and whether housing or health elements might apply.",
  };
}

function scoreAppeal(input: {
  stage: UcClaimStage;
  story: string;
  answers: Record<string, string>;
}): { likelihood: UcLikelihood; summary: string } {
  const hay = `${input.story} ${Object.values(input.answers).join(" ")}`.toLowerCase();
  const mr = yn(input.answers.mr_done || "");
  const decisionDate = (input.answers.decision_date || "").toLowerCase();
  const goodReason = yn(input.answers.good_reason || "");

  if (input.stage === "new_claim" && !/\b(refused|decision|turned down)\b/.test(hay)) {
    return {
      likelihood: "unsure",
      summary:
        "If you have not had a decision yet, the priority is making/correcting the claim — appeal rights usually start after a written decision you disagree with.",
    };
  }

  const late =
    /\b(longer|months? ago|years? ago|late|missed)\b/.test(decisionDate) ||
    /\b(missed|out of time|too late)\b/.test(hay);

  if (input.stage === "sanction") {
    if (goodReason === "yes") {
      return {
        likelihood: "possible",
        summary:
          "If you can show good reason for the missed requirement, challenging a sanction can be realistic. Put that evidence in an MR (and appeal if needed) quickly.",
      };
    }
    if (goodReason === "no") {
      return {
        likelihood: "unlikely",
        summary:
          "Without a good reason, a sanction challenge is harder — still check DWP followed the rules and get free advice before you give up.",
      };
    }
  }

  if (/\b(no evidence|no proof|they'?re wrong but)\b/.test(hay) && !/\b(doctor|medical|letter|tenancy|proof)\b/.test(hay)) {
    return {
      likelihood: "unlikely",
      summary:
        "Appeals without evidence that answers DWP’s reasons are hard. Gather medical, rent, journal, or earnings proof that matches the dispute before you invest hope in a tribunal.",
    };
  }

  if (
    (input.stage === "decision_challenge" ||
      input.stage === "mandatory_reconsideration" ||
      input.stage === "tribunal_appeal" ||
      input.stage === "overpayment") &&
    (/\b(medical|doctor|hospital|tenancy|rent proof|journal|evidence)\b/.test(hay) ||
      /\b(lcw|lcwra|housing|child)\b/.test(hay))
  ) {
    if (late && mr === "no") {
      return {
        likelihood: "possible",
        summary:
          "You may still challenge, but lateness needs an explanation. Ask for MR (or appeal) anyway and explain the delay — free advice can help with wording.",
      };
    }
    if (mr === "yes" || input.stage === "tribunal_appeal") {
      return {
        likelihood: "possible",
        summary:
          "With a clear disagreement and some evidence, an MR or tribunal appeal can be worth running. Success still depends on facts and law — not guaranteed.",
      };
    }
    return {
      likelihood: "possible",
      summary:
        "You appear to have grounds to ask DWP to look again. Start with mandatory reconsideration unless you already have an MR notice — then appeal.",
    };
  }

  if (late && mr !== "yes") {
    return {
      likelihood: "unsure",
      summary:
        "Deadline risk is high. You can often still ask late with reasons, but do not wait — get free benefits advice this week.",
    };
  }

  return {
    likelihood: "unsure",
    summary:
      "Appeal prospects depend on (1) a written decision, (2) being in time or explaining lateness, (3) evidence that answers DWP’s reasons. We need those pieces for a clearer triage.",
  };
}

function processForStage(stage: UcClaimStage): { headline: string; doors: UcProcessDoor[] } {
  const baseChallenge: UcProcessDoor[] = [
    {
      id: "keep-decision",
      title: "Keep the decision letter / journal notice",
      band: "do_now",
      summary: "Dates, the reason code, and what DWP decided matter for MR and appeal deadlines.",
      sourceUrl: GOV_UC,
    },
    {
      id: "mr",
      title: "Mandatory reconsideration",
      band: "usual_next",
      summary:
        "Ask DWP to look at the decision again before most tribunal appeals. Use the journal or the GOV.UK route.",
      deadlineHint: "Usually within 1 month of the decision date (late applications sometimes accepted with reasons).",
      sourceUrl: GOV_MR,
    },
    {
      id: "appeal",
      title: "Appeal to the tribunal",
      band: "if_needed",
      summary:
        "If the MR notice still disagrees with you, you can usually appeal to the First-tier Tribunal (Social Security and Child Support).",
      deadlineHint: "Usually within 1 month of the mandatory reconsideration notice.",
      sourceUrl: GOV_APPEAL,
    },
  ];

  switch (stage) {
    case "new_claim":
      return {
        headline:
          "First we check whether UC is the right benefit and what you’d need to prove — then how to challenge if a decision looks wrong.",
        doors: [
          {
            id: "eligibility",
            title: "Check eligibility rules",
            band: "do_now",
            summary: "Residence, age, work/income, and capital rules decide whether a claim can succeed.",
            sourceUrl: GOV_ELIGIBILITY,
          },
          {
            id: "verify-claim",
            title: "Complete identity and evidence asks",
            band: "do_now",
            summary: "Missing evidence is a common reason claims stall or pay the wrong amount.",
            sourceUrl: GOV_UC,
          },
          {
            id: "journal",
            title: "Use your UC journal",
            band: "usual_next",
            summary: "Keep written questions and DWP replies so you have a trail if you need to challenge later.",
            sourceUrl: GOV_UC,
          },
          ...baseChallenge,
        ],
      };
    case "sanction":
      return {
        headline: "Sanctions cut payments for a period — you have rights to challenge and, if needed, ask about hardship support.",
        doors: [
          {
            id: "sanction-notice",
            title: "Read why you were sanctioned",
            band: "do_now",
            summary: "Check the reason, the length, and whether you had a good reason for what DWP allege.",
            sourceUrl: GOV_SANCTION,
          },
          {
            id: "hardship",
            title: "Ask about hardship payments",
            band: "usual_next",
            summary: "If you’re in hardship because of a sanction, ask DWP about a hardship payment while you challenge.",
            sourceUrl: GOV_UC,
          },
          ...baseChallenge,
        ],
      };
    case "overpayment":
      return {
        headline: "Overpayment decisions can be challenged — on whether you were overpaid and how recovery works.",
        doors: [
          {
            id: "overpay-figures",
            title: "Get the overpayment breakdown",
            band: "do_now",
            summary: "Ask for the period, amount, and why DWP say you were overpaid.",
            sourceUrl: GOV_UC,
          },
          ...baseChallenge,
        ],
      };
    case "tribunal_appeal":
      return {
        headline: "At tribunal stage, your rights turn on evidence that answers DWP’s reasons — the tribunal is independent.",
        doors: [
          {
            id: "appeal-form",
            title: "Lodge the appeal on time",
            band: "do_now",
            summary: "Use the GOV.UK appeal route after you have the MR notice.",
            deadlineHint: "Usually 1 month from the MR notice.",
            sourceUrl: GOV_APPEAL,
          },
          {
            id: "bundle",
            title: "Match evidence to the reasons",
            band: "usual_next",
            summary: "Medical evidence, rent proofs, journal printouts — tied to what DWP wrote.",
            sourceUrl: GOV_APPEAL,
          },
          {
            id: "hearing",
            title: "Hearing or paper determination",
            band: "if_needed",
            summary: "You can often ask for a hearing; free advisers can help you prepare.",
            sourceUrl: GOV_APPEAL,
          },
        ],
      };
    case "mandatory_reconsideration":
      return {
        headline: "Mandatory reconsideration is your right to make DWP look again — then appeal if they still disagree.",
        doors: baseChallenge,
      };
    case "payment_problem":
      return {
        headline: "Wrong or missing payments may be a calculation issue — or a decision you have a right to challenge.",
        doors: [
          {
            id: "statement",
            title: "Check your UC statement",
            band: "do_now",
            summary: "See what elements were paid, deductions, and any open to-dos.",
            sourceUrl: GOV_UC,
          },
          {
            id: "journal-pay",
            title: "Message on your journal",
            band: "do_now",
            summary: "Ask DWP in writing why the payment is wrong or late — keep the reply.",
            sourceUrl: GOV_UC,
          },
          ...baseChallenge,
        ],
      };
    case "decision_challenge":
      return {
        headline: "You have a right to challenge a UC decision you disagree with — usually MR first, then tribunal.",
        doors: baseChallenge,
      };
    default:
      return {
        headline:
          "We’ll explain the UC rules that fit your situation, triage whether a claim or challenge looks realistic, and show the next doors.",
        doors: [
          {
            id: "name-the-problem",
            title: "Name what went wrong",
            band: "do_now",
            summary: "Eligibility, wrong element, sanction, overpayment, or delayed payment — each engages different rights.",
            sourceUrl: GOV_UC,
          },
          ...baseChallenge,
        ],
      };
  }
}

export function isUniversalCreditStory(story: string): boolean {
  return /\b(universal credit|\buc\b|uc claim|uc (?:appeal|sanction|overpay|journal|payment)|dwp (?:decision|sanction)|mandatory reconsideration|benefits? (?:appeal|tribunal)|pip appeal|esa appeal|entitle[md] to (?:uc|universal credit)|can i (?:get|claim) (?:uc|universal credit))\b/i.test(
    story,
  );
}

export function buildUniversalCreditMap(input: {
  kind?: DisputeKind | null;
  story: string;
  ucAnswers?: Record<string, string>;
}): UcMapResult | null {
  const story = input.story || "";
  const answers = input.ucAnswers || {};
  const kindIsBenefits = input.kind === "benefits";
  if (!kindIsBenefits && !isUniversalCreditStory(story)) return null;

  const stage = detectUcStage(story, answers);
  const { headline, doors } = processForStage(stage);
  const lawTopics = selectLawTopics(stage, story, answers);
  const entitlement = scoreEntitlement({ stage, story, answers });
  const appeal = scoreAppeal({ stage, story, answers });

  const rightsMessages = lawTopics.map((topic) => {
    const source = topic.sourceUrl ? ` ([Source](${topic.sourceUrl}))` : "";
    return (
      `${topic.title}: ${topic.rightInPlainEnglish} ` +
      `${topic.whatItMeansForYou}${source}`
    );
  });

  rightsMessages.push(
    `Entitlement triage: ${entitlement.likelihood} — ${entitlement.summary}`,
  );
  rightsMessages.push(
    `Challenge / appeal triage: ${appeal.likelihood} — ${appeal.summary}`,
  );
  rightsMessages.push(
    "This is guidance to help you understand your rights — not a DWP decision or legal advice.",
  );

  const evidenceTips = [
    "Decision letter or journal screenshot with the date and reason.",
    "Any medical or fit-for-work evidence if LCW / LCWRA is in dispute.",
    "Rent / childcare / earnings proofs if an element amount is wrong.",
    "A short timeline: claim date → decision → what you asked DWP → replies.",
  ];
  if (stage === "sanction") {
    evidenceTips.unshift(
      "Appointment letters, messages showing why you could not attend, and any good-reason evidence.",
    );
  }
  if (stage === "overpayment") {
    evidenceTips.unshift(
      "Bank statements for the period and anything showing DWP had the correct information.",
    );
  }

  const nextSteps = [
    "Read the rights explanations above against your decision letter.",
    "Save every DWP decision date — MR and appeal clocks usually run from those dates.",
    "Use free benefits advice before paying anyone.",
    "If you miss a deadline, still ask — explain why you were late.",
  ];

  return {
    stage,
    headline,
    lawTopics,
    rightsMessages,
    entitlementLikelihood: entitlement.likelihood,
    entitlementSummary: entitlement.summary,
    appealLikelihood: appeal.likelihood,
    appealSummary: appeal.summary,
    processDoors: doors,
    helpDoors: UC_HELP_DOORS,
    evidenceTips,
    financingNote:
      "UC challenges are usually free-advice territory. Paid solicitors are rarely needed early.",
    legalAidNote:
      "Most day-to-day Universal Credit advice and First-tier Tribunal appeals are outside mainstream civil legal aid. Free advice does the bulk of this work.",
    nextSteps,
    honestNote:
      "We explain the rules and triage likely/unlikely — we cannot decide your claim. DWP and, on appeal, the tribunal decide. Use your journal and GOV.UK for formal steps.",
    checkUrl: GOV_MR,
    appealUrl: GOV_APPEAL,
    eligibilityUrl: GOV_ELIGIBILITY,
  };
}

export function universalCreditMapToPlanDetail(map: UcMapResult): string {
  return [
    map.headline,
    "",
    "Your rights (plain English):",
    ...map.lawTopics.map(
      (t) => `• ${t.title}: ${t.rightInPlainEnglish} ${t.whatItMeansForYou}`,
    ),
    "",
    `Entitlement triage (${map.entitlementLikelihood}): ${map.entitlementSummary}`,
    `Challenge/appeal triage (${map.appealLikelihood}): ${map.appealSummary}`,
    "",
    "Process doors:",
    ...map.processDoors.map((d) => {
      const deadline = d.deadlineHint ? ` Deadline: ${d.deadlineHint}` : "";
      return `• ${d.title}: ${d.summary}${deadline}`;
    }),
    "",
    "Evidence to gather:",
    ...map.evidenceTips.map((t) => `• ${t}`),
    "",
    map.legalAidNote,
    map.financingNote,
    "",
    "Next steps:",
    ...map.nextSteps.map((s) => `• ${s}`),
    "",
    map.honestNote,
    `Eligibility: ${map.eligibilityUrl}`,
    `Challenge: ${map.checkUrl}`,
    `Appeal: ${map.appealUrl}`,
  ].join("\n");
}
