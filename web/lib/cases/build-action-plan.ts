import type {
  ActionPlan,
  ActionPlanFinancingMap,
  ActionPlanLegalAidMap,
  ActionPlanStep,
  ActionPlanTimelineItem,
  ActionPlanUcMap,
  CaseProfileAnswers,
  FundingKnowledge,
  FundingPreference,
} from "@/lib/cases/types";
import type { DisputeKind } from "@/lib/cases/dispute-context";
import { freeServicesForKind } from "@/lib/cases/free-services";
import { isSolicitorComplaintStory } from "@/lib/cases/solicitor-complaint";
import {
  buildFinancingMap,
  financingMapToPlanDetail,
} from "@/lib/cases/litigation-financing";
import {
  buildLegalAidMap,
  legalAidMapToPlanDetail,
  GOV_FIND_PROVIDER,
  GOV_LEGAL_AID_ELIGIBILITY,
} from "@/lib/cases/legal-aid-knowledge";
import {
  buildUniversalCreditMap,
  universalCreditMapToPlanDetail,
} from "@/lib/cases/universal-credit-knowledge";
import {
  detectGuideNation,
  GUIDE_ATTRIBUTION,
  guideSignpostNotes,
  nationLabel,
  pdfForNation,
} from "@/lib/cases/pro-bono-guide-knowledge";
/** Client-safe Blog deep link (avoids importing server-only wiki index into the browser bundle). */
function wikiLinkForStory(story: string, kind: DisputeKind | null): {
  wikiPath?: string;
  wikiTitle?: string;
} {
  const q = [kind && kind !== "general" ? kind.replace(/_/g, " ") : "", story]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (!q) return { wikiPath: "/blog", wikiTitle: "Browse Blog / wiki" };
  return {
    wikiPath: `/blog?q=${encodeURIComponent(q)}`,
    wikiTitle: "Related guides on the Blog",
  };
}

function documentDeadlines(answers: CaseProfileAnswers): string[] {
  const fromBriefs =
    answers.documentBriefs?.flatMap((b) => b.brief.deadlines || []) || [];
  return [...new Set(fromBriefs.map((d) => d.trim()).filter(Boolean))].slice(0, 4);
}

function buildTimeline(opts: {
  steps: ActionPlanStep[];
  answers: CaseProfileAnswers;
  kind: DisputeKind | null;
  story: string;
}): ActionPlanTimelineItem[] {
  const deadlines = documentDeadlines(opts.answers);
  const wiki = wikiLinkForStory(opts.story, opts.kind);
  const items: ActionPlanTimelineItem[] = [];

  items.push({
    id: "tl-week",
    band: "this_week",
    label: "This week",
    detail:
      "Gather the letter/photo, note any deadline, and contact a free advice door from your plan before you pay anyone.",
    wikiPath: wiki.wikiPath,
    wikiTitle: wiki.wikiTitle,
  });

  if (deadlines.length) {
    items.push({
      id: "tl-deadline",
      band: "before_deadline",
      label: "Before the deadline on your papers",
      detail: `Your documents mention: ${deadlines.join("; ")}. Diary the date, keep proof of sending, and use the appeal/response route named in the notice if there is one.`,
      dueHint: deadlines[0],
      wikiPath: wiki.wikiPath,
      wikiTitle: wiki.wikiTitle,
    });
  } else {
    items.push({
      id: "tl-deadline",
      band: "before_deadline",
      label: "Before any response window closes",
      detail:
        "If the letter has a pay/appeal/reply date, treat that as urgent. If none is clear, ask the issuer or a free adviser what the time limit is — don’t guess.",
      wikiPath: wiki.wikiPath,
      wikiTitle: wiki.wikiTitle,
    });
  }

  items.push({
    id: "tl-later",
    band: "later",
    label: "Later — if free doors aren’t enough",
    detail:
      "Map financing (legal aid, insurance, no win no fee, or private fixed fee) before instructing a solicitor on a complex matter. Open Financing from your plan when you’re ready.",
  });

  // Tag a few plan steps with bands for UI hints
  for (const step of opts.steps) {
    if (step.id === "gather" || step.id === "understand" || step.id === "free-services") {
      step.whenBand = "this_week";
      if (wiki.wikiPath) {
        step.wikiPath = wiki.wikiPath;
        step.wikiTitle = wiki.wikiTitle;
      }
    } else if (step.id === "who-helps" || step.id === "options") {
      step.whenBand = deadlines.length ? "before_deadline" : "this_week";
      if (deadlines[0]) step.dueHint = deadlines[0];
      if (wiki.wikiPath) {
        step.wikiPath = wiki.wikiPath;
        step.wikiTitle = wiki.wikiTitle;
      }
    } else if (step.id === "financing" || step.id === "spend") {
      step.whenBand = "later";
    }
  }

  return items;
}

function spendAdviceFor(preference: FundingPreference | null): string {
  switch (preference) {
    case "legal_aid":
      return "Check legal aid before paying privately — you may not need to spend yet. For complex claims, confirm funding before heavy solicitor work.";
    case "pro_bono":
      return "Start with free doors. Only pay if you hit a wall or need a specialist letter — map costs before you instruct.";
    case "insurance":
      return "Call your insurer or union first; paying yourself can wait until they say no. Litigation cover often matters most on complex claims.";
    case "fixed_fee":
    case "private":
      return "A short fixed-fee consult can be worth it once your papers and financing map are ready — not before.";
    default:
      return "Map free advice and legal aid before private solicitor costs — especially if the claim is complex or contested.";
  }
}

/** Clean chat/markdown source tags into plain readable plan copy. */
export function cleanPlanText(raw: string): string {
  return raw
    .replace(/\[Source\]\((https?:\/\/[^)\s]+)\)/gi, " (Source)")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([.!?])([A-Za-z])/g, "$1 $2")
    .trim();
}

/**
 * Turn the multi-message options explanation into spaced bullet points
 * for the Plan of Action (never one jammed paragraph).
 */
export function formatOptionsForPlan(explained: string): string {
  let raw = cleanPlanText(explained);
  // Older plans flattened newlines — re-split before option titles.
  if (!raw.includes("\n")) {
    raw = raw
      .replace(/\s+This is guidance to help you act[^.]*\./gi, "")
      .replace(
        /\s+(?=(?:Talk or write|Keep a log|Council or mediation|Apply together|Apply on your own|Children arrangements|Money and property|Agree without|Confirm your tenancy|Gather evidence|Raise it|Escalation routes|Raise it at work|ACAS|Employment tribunal|Complain to the trader|Card or finance|Alternative dispute|Sort priority|Budget and contact|Formal options|Clarify the problem|Get a free check)[:])/g,
        "\n",
      )
      .replace(/\s+\((?:Source)\)\s+/g, " (Source)\n");
  }

  const lines = raw
    .split(/\n+/)
    .map((line) => cleanPlanText(line))
    .filter(Boolean);

  if (!lines.length) return "";

  const [overview, ...rest] = lines;
  const bullets: string[] = [];
  for (const line of rest) {
    if (/^this is guidance/i.test(line)) continue;
    const body = line.replace(/^[-•*]\s+/, "").trim();
    if (body.length < 8) continue;
    bullets.push(`• ${body}`);
  }

  const parts = [cleanPlanText(overview)];
  if (bullets.length) parts.push("", ...bullets);
  return parts.join("\n").slice(0, 1600);
}

function understandDetail(
  story: string,
  answers: CaseProfileAnswers,
  kind: DisputeKind | null,
): string {
  const bits: string[] = [];
  const base = story.trim();
  if (base) bits.push(base.length > 160 ? `${base.slice(0, 157).trim()}…` : base);

  const da = answers.disputeAnswers || {};
  if (kind === "divorce") {
    if (da.divorce_application) bits.push(`Application: ${da.divorce_application}.`);
    if (da.divorce_children) bits.push(`Children: ${da.divorce_children}.`);
    if (da.divorce_assets) bits.push(`Money/property: ${da.divorce_assets}.`);
  } else {
    for (const [k, v] of Object.entries(da)) {
      if (v?.trim()) bits.push(`${k.replaceAll("_", " ")}: ${v.trim()}.`);
    }
  }

  return cleanPlanText(bits.join(" ")) || "We’ll keep refining this as you share more.";
}

function gatherStep(kind: DisputeKind | null, story: string): ActionPlanStep {
  if (isSolicitorComplaintStory(story)) {
    return {
      id: "gather",
      label: "What to gather next",
      detail:
        "Build a short timeline: when you instructed them, what they promised, fees paid, missed deadlines, and every email/letter. Keep a copy of your formal complaint to the firm and any final response — the Legal Ombudsman will ask for these.",
      doorType: "self_help",
    };
  }
  if (kind === "divorce") {
    return {
      id: "gather",
      label: "What to gather next",
      detail:
        "Marriage certificate, any children details, and a rough list of home, pensions, and savings. Keep a simple timeline of what you’ve already agreed. You can upload letters or photos into Your case.",
      doorType: "self_help",
    };
  }
  if (kind === "benefits") {
    return {
      id: "gather",
      label: "What to gather next",
      detail:
        "UC decision letter or journal notice with the date, any mandatory reconsideration notice, medical/rent/earnings proofs that match what DWP got wrong, and a short timeline. Upload copies into Your case if you have them.",
      doorType: "self_help",
    };
  }
  return {
    id: "gather",
    label: "What to gather next",
    detail:
      "Collect dates, letters, emails, contracts, photos, and reference numbers in one place. Upload copies into Your case if you have them.",
    doorType: "self_help",
  };
}

function solicitorMatchBlurb(answers: CaseProfileAnswers): string | null {
  const mode = answers.solicitorMatchMode;
  if (!mode) return null;
  if (mode === "local" && answers.solicitorLocation) {
    return `You asked for a local solicitor near ${answers.solicitorLocation} — matches below come from our SRA register.`;
  }
  if (mode === "local") {
    return "You asked for a local solicitor — matches below come from our SRA register.";
  }
  if (mode === "online") {
    return "You asked for someone you can deal with online — matches below come from our SRA register.";
  }
  if (mode === "reviews") {
    return "You asked to compare by public reviews — matches below come from our SRA register; check reviews before you instruct.";
  }
  return "Solicitor matches below come from our SRA register when available.";
}

function whoHelpsStep(
  kind: DisputeKind | null,
  pref: FundingPreference | null,
  story: string,
  answers: CaseProfileAnswers,
): ActionPlanStep {
  const sraNote = solicitorMatchBlurb(answers);
  if (isSolicitorComplaintStory(story)) {
    return {
      id: "who-helps",
      label: "Who to contact first",
      detail:
        "Complain to the firm in writing first (keep copies). For poor service, delays, or bill disputes escalate to the Legal Ombudsman after their final response or 8 weeks. For dishonesty or serious misconduct, report to the SRA. A fresh solicitor for a second opinion can help if the underlying case still needs progressing." +
        (sraNote ? ` ${sraNote}` : ""),
      doorType: "free_advice",
    };
  }
  if (kind === "divorce") {
    return {
      id: "who-helps",
      label: "Who to contact first",
      detail:
        (pref === "private" || pref === "fixed_fee"
          ? "Once your papers are ready, a family solicitor helps most with consent orders and complex pensions or property. Free advice first if you still want a second check."
          : "Start with free family guidance or a law centre/clinic, then mediation if you can agree. Then use SRA-register solicitor matches when you’re ready.") +
        (sraNote ? ` ${sraNote}` : ""),
      doorType: "directory",
    };
  }
  return {
    id: "who-helps",
    label: "Who to contact first",
    detail:
      (pref === "private" || pref === "fixed_fee"
        ? "When your timeline is ready, matched SRA-register solicitors can help. Free advice first if you want a second check."
        : "Start with free national help, then use SRA-register solicitor matches when you’re ready.") +
      (sraNote ? ` ${sraNote}` : ""),
    doorType: "directory",
  };
}

export function buildActionPlan(input: {
  story: string;
  title: string;
  fundingKnowledge: FundingKnowledge | null;
  fundingPreference: FundingPreference | null;
  answers: CaseProfileAnswers;
  disputeKind?: DisputeKind | null;
  optionsExplanation?: string | null;
}): ActionPlan {
  const steps: ActionPlanStep[] = [];
  const kind = input.disputeKind || input.answers.disputeKind || null;
  const pref = input.fundingPreference;

  steps.push({
    id: "how-we-help",
    label: "How Legal Shaman helps",
    detail:
      "We’re a helpful tool to access justice. We signpost and help you map the path — what happened, claim forms and next steps, financing options, through to solicitor costs where needed. We cover all kinds of claims; financing is especially important when a case is complex or contested. We are not a solicitor and this is not legal advice.",
    doorType: "self_help",
  });

  steps.push({
    id: "understand",
    label: "What we think is going on",
    detail: understandDetail(input.story, input.answers, kind),
    doorType: "self_help",
  });

  const explained =
    input.optionsExplanation || input.answers.optionsExplanation || "";
  if (explained.trim()) {
    steps.push({
      id: "options",
      label: "Your options explained",
      detail: formatOptionsForPlan(explained),
      doorType: "self_help",
    });
  }

  steps.push(gatherStep(kind, input.story));

  if (kind === "divorce") {
    const da = input.answers.disputeAnswers || {};
    const children = (da.divorce_children || "").toLowerCase();
    const assets = (da.divorce_assets || "").toLowerCase();
    if (/\b(yes|kid|child|son|daughter)\b/.test(children)) {
      steps.push({
        id: "children",
        label: "Children arrangements",
        detail:
          "Child arrangements are separate from the divorce paperwork. Try to agree living/time and maintenance; mediation can help before court.",
        doorType: "self_help",
      });
    }
    if (/\b(home|house|pension|saving|property|complex|yes|market)\b/.test(assets)) {
      steps.push({
        id: "finances-family",
        label: "Money and property",
        detail:
          "List home, pensions, and savings. If you agree, a consent order can make it binding. A home on the market still needs a clear agreement on proceeds.",
        doorType: "self_help",
      });
    }
  }

  const screened = input.answers.legalAidSummary;
  const screenedLikelihood = input.answers.legalAidLikelihood || null;

  const legalAidBuilt = buildLegalAidMap({
    kind,
    story: input.story,
    screenLikelihood: screenedLikelihood,
    screenSummary: screened,
  });
  const legalAidMap: ActionPlanLegalAidMap = {
    scopeBand: legalAidBuilt.scopeBand,
    headline: legalAidBuilt.headline,
    outOfScopeNote: legalAidBuilt.outOfScopeNote,
    meritsNote: legalAidBuilt.meritsNote,
    honestNote: legalAidBuilt.honestNote,
    likelihood: screenedLikelihood || legalAidBuilt.likelihoodFromKindAlone,
    doors: legalAidBuilt.scopeDoors.map((d) => ({
      id: d.id,
      title: d.title,
      band: d.band,
      summary: d.summary,
      examples: d.examples,
      url: d.sourceUrl,
    })),
    meansRules: legalAidBuilt.meansRules.map((r) => ({
      id: r.id,
      title: r.title,
      summary: r.summary,
      url: r.sourceUrl,
    })),
    nextSteps: legalAidBuilt.nextSteps,
    checkUrl: GOV_LEGAL_AID_ELIGIBILITY,
    findProviderUrl: GOV_FIND_PROVIDER,
  };

  steps.push({
    id: "legal-aid-map",
    label: "Legal aid map for this claim",
    detail: cleanPlanText(legalAidMapToPlanDetail(legalAidBuilt)),
    doorType: "legal_aid",
  });

  const ucBuilt = buildUniversalCreditMap({
    kind,
    story: input.story,
    ucAnswers: input.answers.ucAnswers,
  });
  let universalCreditMap: ActionPlanUcMap | null = null;
  if (ucBuilt) {
    universalCreditMap = {
      stage: ucBuilt.stage,
      headline: ucBuilt.headline,
      lawTopics: ucBuilt.lawTopics.map((t) => ({
        id: t.id,
        title: t.title,
        rightInPlainEnglish: t.rightInPlainEnglish,
        whatItMeansForYou: t.whatItMeansForYou,
        sourceUrl: t.sourceUrl,
        sourceLabel: t.sourceLabel,
      })),
      entitlementLikelihood:
        input.answers.ucEntitlementLikelihood || ucBuilt.entitlementLikelihood,
      entitlementSummary: ucBuilt.entitlementSummary,
      appealLikelihood:
        input.answers.ucAppealLikelihood || ucBuilt.appealLikelihood,
      appealSummary: ucBuilt.appealSummary,
      processDoors: ucBuilt.processDoors.map((d) => ({
        id: d.id,
        title: d.title,
        band: d.band,
        summary: d.summary,
        deadlineHint: d.deadlineHint,
        url: d.sourceUrl,
      })),
      helpDoors: ucBuilt.helpDoors.map((h) => ({
        id: h.id,
        name: h.name,
        blurb: h.blurb,
        url: h.url,
        phone: h.phone,
      })),
      evidenceTips: ucBuilt.evidenceTips,
      financingNote: ucBuilt.financingNote,
      legalAidNote: ucBuilt.legalAidNote,
      nextSteps: ucBuilt.nextSteps,
      honestNote: ucBuilt.honestNote,
      checkUrl: ucBuilt.checkUrl,
      appealUrl: ucBuilt.appealUrl,
      eligibilityUrl: ucBuilt.eligibilityUrl,
    };
    steps.push({
      id: "universal-credit-map",
      label: "Universal Credit rights & options",
      detail: cleanPlanText(universalCreditMapToPlanDetail(ucBuilt)),
      doorType: "free_advice",
    });
  }

  const financingBuilt = buildFinancingMap({
    kind,
    story: input.story,
    preference: pref,
    legalAidLikelihood: screenedLikelihood || legalAidBuilt.likelihoodFromKindAlone,
  });
  const financingMap: ActionPlanFinancingMap = {
    complexity: financingBuilt.complexity,
    complexityReason: financingBuilt.complexityReason,
    honestNote: financingBuilt.honestNote,
    options: financingBuilt.routes.map((r) => ({
      id: r.id,
      title: r.title,
      blurb: `${r.summary} ${r.whenItFits}`.trim(),
      likelihood: r.likelihood,
      url: r.sourceUrl,
      sourceLabel: r.sourceLabel,
    })),
    contacts: financingBuilt.contacts.map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      blurb: c.blurb,
      url: c.url,
    })),
  };

  let preferenceLine = "";
  if (pref === "legal_aid") {
    preferenceLine =
      (screened ? `${screened} ` : "") +
      "Your preference leans legal aid — a legal-aid provider still confirms means and merits.";
  } else if (pref === "pro_bono") {
    preferenceLine =
      "You prefer free advice first — keep that door open while checking insurance and whether specialist funding could ever apply.";
  } else if (pref === "insurance") {
    preferenceLine =
      "You flagged insurance/union cover — check BTE legal expenses before private fees or ATE.";
  } else if (pref === "fixed_fee" || pref === "private") {
    preferenceLine =
      "You are open to paying — still use the menu below so free, CFA, and insurance doors are not skipped.";
  } else if (pref === "unsure" || screened) {
    preferenceLine =
      screened ||
      "You’re unsure about funding — normal. Use the menu below before solicitor costs rise.";
  }

  const financeDetail = cleanPlanText(
    [preferenceLine, financingMapToPlanDetail(financingBuilt)].filter(Boolean).join("\n\n"),
  );

  steps.push({
    id: "financing",
    label: "Financing path — claim to costs",
    detail: financeDetail,
    doorType:
      pref === "legal_aid"
        ? "legal_aid"
        : pref === "private" || pref === "fixed_fee"
          ? "paid"
          : "free_advice",
    spendAdvice: spendAdviceFor(pref),
  });

  const nation =
    input.answers.ukNation || detectGuideNation(input.story);
  const freeServices = freeServicesForKind(kind, input.story, nation);
  const guidePdf = pdfForNation(nation);
  const freeAdviceGuide = {
    nation,
    nationLabel: nationLabel(nation),
    hubUrl: GUIDE_ATTRIBUTION.hubUrl,
    pdfUrl: guidePdf.href,
    pdfLabel: guidePdf.label,
    notes: guideSignpostNotes(nation),
  };
  steps.push({
    id: "free-services",
    label: "Free services that may apply",
    detail:
      `Guided by the Pro Bono Week free-advice directories (${nationLabel(nation)}). ` +
        (freeServices.map((s) => `${s.name} — ${s.blurb}`).join(" ") ||
          "We’ll list free doors that fit this situation on Your case."),
    doorType: "free_advice",
  });

  steps.push(whoHelpsStep(kind, pref, input.story, input.answers));

  if (input.answers.wantSpeakToSomeone) {
    const mode = input.answers.solicitorMatchMode;
    const place = input.answers.solicitorLocation;
    const modeLine =
      mode === "local" && place
        ? ` Matching preference: local near ${place} via our SRA register.`
        : mode === "local"
          ? " Matching preference: local via our SRA register."
          : mode === "online"
            ? " Matching preference: online-friendly via our SRA register."
            : mode === "reviews"
              ? " Matching preference: compare public reviews via our SRA register."
              : "";
    steps.push({
      id: "speak-to-someone",
      label: "Speaking to someone",
      detail: `You said: ${input.answers.wantSpeakToSomeone}.${modeLine} We’ll keep human help in view alongside your plan.`,
      doorType: "directory",
    });
  }

  if (input.answers.freeServicesTried) {
    steps.push({
      id: "already-tried",
      label: "Free help you’ve already tried",
      detail: input.answers.freeServicesTried,
      doorType: "self_help",
    });
  }

  steps.push({
    id: "spend",
    label: "When spending money is worth it",
    detail: spendAdviceFor(pref),
    doorType: "paid",
    spendAdvice: spendAdviceFor(pref),
  });

  steps.push({
    id: "financing",
    label: "Financing access to justice",
    detail:
      "Open the financing map for no win no fee, legal aid, insurance, and specialist funders when the dispute is complex. Free advice first.",
    doorType: "paid",
    whenBand: "later",
    url: "/financing",
  });

  const timeline = buildTimeline({
    steps,
    answers: input.answers,
    kind,
    story: input.story,
  });

  return {
    steps,
    timeline,
    freeServices,
    matchedSolicitors: [],
    solicitorMatchMode: input.answers.solicitorMatchMode,
    solicitorLocation: input.answers.solicitorLocation || null,
    financingMap,
    legalAidMap,
    universalCreditMap,
    freeAdviceGuide,
    updatedAt: new Date().toISOString(),
  };
}
