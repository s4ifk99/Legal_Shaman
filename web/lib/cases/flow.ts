import type {
  ActionPlan,
  CaseProfileAnswers,
  FundingKnowledge,
  FundingPreference,
} from "@/lib/cases/types";
import { buildActionPlan } from "@/lib/cases/build-action-plan";
import {
  deepenStoryPrompt,
  detectDisputeKind,
  disputeQuestionAt,
  getDisputePack,
  storyIsRichEnough,
  storyNeedsDeepening,
  type DisputeKind,
} from "@/lib/cases/dispute-context";
import {
  formatOptionsForChat,
  formatOptionsMessages,
  getProcessGuide,
} from "@/lib/cases/process-guides";
import {
  legalAidIntroHeard,
  legalAidIntroNeverHeard,
  legalAidQuestionsFor,
  scoreLegalAidScreen,
} from "@/lib/cases/legal-aid-screen";
import { buildLegalAidMap } from "@/lib/cases/legal-aid-knowledge";
import {
  buildUniversalCreditMap,
  detectUcStage,
  ucScreenQuestionsFor,
} from "@/lib/cases/universal-credit-knowledge";
import { detectGuideNation } from "@/lib/cases/pro-bono-guide-knowledge";
import type { DocumentBrief } from "@/lib/cases/document-brief";
import { documentBriefToStorySeed } from "@/lib/cases/document-brief";

export type FlowPhase =
  | "need_account"
  | "collect_story"
  | "speak_to_someone"
  | "solicitor_match_mode"
  | "solicitor_location"
  | "dispute_context"
  | "uc_rights_screen"
  | "await_explain"
  | "options_clarify"
  | "legal_aid_heard"
  | "legal_aid_explain"
  | "legal_aid_screen"
  | "uk_nation"
  | "free_services_tried"
  | "free_advice_first"
  | "open_to_paying"
  | "insurance_cover"
  | "building_plan"
  | "done";

export type FlowMessage = {
  id: string;
  role: "shaman" | "you";
  text: string;
};

export type FlowState = {
  phase: FlowPhase;
  messages: FlowMessage[];
  answers: CaseProfileAnswers;
  disputeKind: DisputeKind | null;
  disputeQIndex: number;
  legalAidQIndex: number;
  ucRightsQIndex: number;
  fundingKnowledge: FundingKnowledge | null;
  fundingPreference: FundingPreference | null;
  fundingNotes: string;
  title: string;
  summary: string;
  actionPlan: ActionPlan | null;
  optionsExplanation: string | null;
  inputHint: string;
};

let msgSeq = 0;
function mid(): string {
  msgSeq += 1;
  return `m-${Date.now()}-${msgSeq}`;
}

const MIC = "Tap the mic if speaking is easier.";

function emptyAnswersBase(): Pick<
  FlowState,
  | "answers"
  | "disputeKind"
  | "disputeQIndex"
  | "legalAidQIndex"
  | "ucRightsQIndex"
  | "fundingKnowledge"
  | "fundingPreference"
  | "fundingNotes"
  | "title"
  | "summary"
  | "actionPlan"
  | "optionsExplanation"
> {
  return {
    answers: {},
    disputeKind: null,
    disputeQIndex: 0,
    legalAidQIndex: 0,
    ucRightsQIndex: 0,
    fundingKnowledge: null,
    fundingPreference: null,
    fundingNotes: "",
    title: "",
    summary: "",
    actionPlan: null,
    optionsExplanation: null,
  };
}

export function createInitialFlow(_signedIn = true): FlowState {
  // Chat runs free for guests; account is only required to open / save full results.
  return {
    phase: "collect_story",
    messages: [
      {
        id: "welcome-1",
        role: "shaman",
        text: "This is the Shaman, a helpful tool to access justice.",
      },
      {
        id: "welcome-2",
        role: "shaman",
        text: "We signpost and help you map the path: what happened, claim forms and next steps, how to finance help, through to solicitor costs where needed.",
      },
      {
        id: "welcome-3",
        role: "shaman",
        text: "We do this for all kinds of claims. Financing matters most when a case is complex.",
      },
      {
        id: "welcome-4",
        role: "shaman",
        text: "Tell me what’s going on in your own words — or upload a letter, PCN, or photo.",
      },
      {
        id: "welcome-5",
        role: "shaman",
        text: MIC,
      },
    ],
    ...emptyAnswersBase(),
    inputHint: "Tell me what happened",
  };
}

/**
 * Inject a vision/OCR document brief into the chat and seed the dispute story when empty.
 */
export function applyDocumentBrief(
  state: FlowState,
  opts: { chatText: string; brief: DocumentBrief; fileName: string; storySeed?: string },
): FlowState {
  const youLine: FlowMessage = {
    id: mid(),
    role: "you",
    text: `Uploaded: ${opts.fileName}`,
  };
  const shamanLine: FlowMessage = {
    id: mid(),
    role: "shaman",
    text: opts.chatText,
  };
  const seed = (opts.storySeed || documentBriefToStorySeed(opts.brief)).trim();
  const existingStory = (state.answers.disputeStory || "").trim();
  const nextStory = existingStory || seed;
  const briefs = [
    ...(state.answers.documentBriefs || []),
    {
      fileName: opts.fileName,
      analyzedAt: new Date().toISOString(),
      brief: opts.brief,
    },
  ].slice(-8);

  return {
    ...state,
    messages: [...state.messages, youLine, shamanLine],
    answers: {
      ...state.answers,
      disputeStory: nextStory || state.answers.disputeStory,
      documentBriefSummary: opts.brief.summary,
      documentBriefs: briefs,
    },
    title: state.title || (nextStory ? titleFromStory(nextStory) : state.title),
    summary: state.summary || opts.brief.summary || state.summary,
    inputHint:
      state.phase === "collect_story"
        ? "Add anything missing, or continue"
        : state.inputHint,
  };
}

function titleFromStory(story: string): string {
  const cleaned = story.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 72) return cleaned || "Your situation";
  return `${cleaned.slice(0, 69).trim()}…`;
}

/** Explicit leave-the-check phrases (safe mid-questionnaire — bare “no” is not enough). */
function wantsSkipLegalAid(text: string): boolean {
  const t = text.toLowerCase().trim();
  return /\b(skip|later|not now|no thanks|no thank|don't want|do not want|dont want|not interested|prefer free|free service|free advice|just free|no legal aid|without legal aid|money options|pay(ing)? privately|private(ly)?|self[- ]?fund)\b/.test(
    t,
  );
}

/** Decline the optional legal-aid offer (bare no is OK here). */
function declinesLegalAidOffer(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (wantsSkipLegalAid(t)) return true;
  return /^(no|nope|nah)([.!?\s]|$)/.test(t);
}

function wantsLegalAidCheck(text: string): boolean {
  const t = text.toLowerCase();
  if (declinesLegalAidOffer(t)) return false;
  return /\b(yes|yeah|yep|ok|okay|check|screen|eligible|eligibility|interested|please|go ahead|sure)\b/.test(
    t,
  );
}

function inferFundingKnowledge(text: string): FundingKnowledge {
  const t = text.toLowerCase();
  if (/\b(used|applied|got|had)\b.*\blegal aid\b|\blegal aid\b.*\b(before|previously)\b/.test(t)) {
    return "used_before";
  }
  if (
    /\b(never heard|not heard|haven't heard|have not heard|dont know what|don't know what|do not know what|whats that|what's that|no idea)\b/.test(
      t,
    )
  ) {
    return "never_heard";
  }
  if (
    /\b(yes|yeah|yep|i have|i've heard|i know|familiar)\b/.test(t) ||
    /\bheard of (it|legal aid)\b/.test(t)
  ) {
    return "heard";
  }
  return "heard";
}

function ensureUkNationFromStory(next: FlowState): void {
  if (next.answers.ukNation && next.answers.ukNation !== "unknown") return;
  const story = next.answers.disputeStory || next.summary || "";
  const detected = detectGuideNation(story);
  if (detected !== "unknown") next.answers.ukNation = detected;
}

function parseUkNation(text: string): "england" | "wales" | "scotland" | "unknown" {
  const t = text.toLowerCase();
  if (/\b(scotland|scottish)\b/.test(t)) return "scotland";
  if (/\b(wales|welsh|cymru)\b/.test(t)) return "wales";
  if (/\b(england|english)\b/.test(t)) return "england";
  if (/\b(not sure|unsure|skip|uk|britain|gb)\b/.test(t)) return "unknown";
  return detectGuideNation(text);
}

function beginFreeServicesTried(
  messages: FlowMessage[],
  next: FlowState,
  leadIn?: string,
): { next: FlowState; shamanBurst: string[] } {
  ensureUkNationFromStory(next);
  if (!next.answers.ukNation || next.answers.ukNation === "unknown") {
    const ask =
      "Quick check so we pick the right free-advice guide: are you in England, Wales, or Scotland? " +
      "Housing and some other rules differ. " +
      MIC;
    const lines = [leadIn, ask].filter(Boolean) as string[];
    const burst = withBurst(messages, lines);
    next.phase = "uk_nation";
    next.messages = burst.messages;
    next.inputHint = "England / Wales / Scotland";
    return { next, shamanBurst: burst.shamanBurst };
  }
  next.phase = "free_services_tried";
  const kind = next.disputeKind || next.answers.disputeKind || null;
  const freeQ = freeServicesPrompt(kind);
  const lines = [leadIn, freeQ].filter(Boolean) as string[];
  const burst = withBurst(messages, lines);
  next.messages = burst.messages;
  next.inputHint = "Yes, no, or say which service";
  return { next, shamanBurst: burst.shamanBurst };
}

function skipLegalAidToFreeServices(
  messages: FlowMessage[],
  next: FlowState,
  note: string,
): {
  next: FlowState;
  shamanBurst: string[];
} {
  next.answers.legalAidLikelihood = next.answers.legalAidLikelihood || "unsure";
  next.answers.legalAidSummary =
    next.answers.legalAidSummary ||
    "Legal aid check skipped — free services and other funding paths still apply.";
  next.answers.legalAidQualify = next.answers.legalAidLikelihood;
  return beginFreeServicesTried(messages, next, note);
}

function startLegalAidScreen(
  messages: FlowMessage[],
  next: FlowState,
  intro: string,
): {
  next: FlowState;
  shamanBurst: string[];
} {
  const qs = legalAidQuestionsFor(next.disputeKind || next.answers.disputeKind || null);
  next.phase = "legal_aid_screen";
  next.legalAidQIndex = 0;
  next.answers.legalAidAnswers = {};
  const burst = withBurst(messages, [intro, qs[0]!.ask]);
  next.messages = burst.messages;
  next.inputHint = qs[0]!.placeholder;
  return { next, shamanBurst: burst.shamanBurst };
}

function yesNoUnsure(text: string): "yes" | "no" | "unsure" {
  const t = text.toLowerCase();
  if (/\b(yes|yeah|yep|please|prefer|rather|first|interested)\b/.test(t)) return "yes";
  if (/\b(no|nope|skip|rather not|don't want|not now|later)\b/.test(t)) return "no";
  return "unsure";
}

function wantsMoreClarify(text: string): boolean {
  const t = text.toLowerCase();
  // Finance answers (legal aid / private pay) mean they’re ready to move on.
  if (/\b(legal aid|pay(ing)? privately|private(ly)?|self[- ]?fund)\b/.test(t)) {
    if (/\b(clarif|explain|more about)\b/.test(t) && !/\b(legal aid|privat)/.test(t)) return true;
    return false;
  }
  // Decline clarify even if the word “clarify” appears (“no clarify”, “don’t explain”).
  if (
    /\b(no|nope|nah|clear|got it|understood|fine|move on|next|money|ready|skip|finance)\b/.test(t) ||
    /\b(don'?t|do not|dont)\b.*\b(clarif|explain|more)\b/.test(t)
  ) {
    if (/\b(not sure|unsure|confused)\b/.test(t) && !/\b(legal aid|privat|pay)\b/.test(t)) return true;
    if (/\b(yes|please)\b/.test(t) && /\b(clarif|explain|more)\b/.test(t)) return true;
    return false;
  }
  if (/\b(yes|please|clarify|explain|more|not sure|unsure|confused|again)\b/.test(t)) return true;
  return false;
}

function resolvePreference(answers: CaseProfileAnswers): FundingPreference {
  const insurance = (answers.insuranceCover || "").toLowerCase();
  if (
    /\b(yes|union|insurance|employer|cover)\b/.test(insurance) &&
    !/\b(no|none|haven't|have not|nope)\b/.test(insurance)
  ) {
    return "insurance";
  }
  const freeFirst = yesNoUnsure(answers.freeAdviceFirst || "");
  const paying = yesNoUnsure(answers.openToPaying || "");
  const likelihood = answers.legalAidLikelihood;

  if (likelihood === "likely" || likelihood === "possible") return "legal_aid";
  if (freeFirst === "yes") return "pro_bono";
  if (paying === "yes") return "fixed_fee";
  if (likelihood === "unsure" || !likelihood) return "unsure";
  return "pro_bono";
}

function speakToSomeonePrompt(kind: DisputeKind | null): string {
  if (kind === "divorce") {
    return (
      "Most people going through divorce want to speak to someone. " +
      "Shall we shape this so you can find the right person when you’re ready — family adviser, mediator, or solicitor? " +
      MIC
    );
  }
  return (
    "Most people in your shoes want to speak to a person. " +
    "Shall we shape this so you can find the right adviser or solicitor when you’re ready? " +
    MIC
  );
}

function solicitorMatchModePrompt(): string {
  return (
    "If you’d like a solicitor, we match from our SRA register and help you see the path to costs — not just a name. " +
    "Do you want someone local to you, someone you can deal with online, or firms to compare by public reviews? " +
    MIC
  );
}

function parseSolicitorMatchMode(
  text: string,
): "local" | "online" | "reviews" | "unsure" {
  const t = text.toLowerCase();
  if (/\b(review|reviews|rated|rating|trustpilot|google)\b/.test(t)) return "reviews";
  if (/\b(online|remote|zoom|video|phone|nationwide|anywhere|not local)\b/.test(t)) {
    return "online";
  }
  if (/\b(local|nearby|near me|postcode|town|city|area|in person|face.?to.?face)\b/.test(t)) {
    return "local";
  }
  if (/\b(skip|not sure|unsure|either|any|no preference|don'?t mind)\b/.test(t)) {
    return "unsure";
  }
  return "unsure";
}

function continueAfterSolicitorPrefs(
  messages: FlowMessage[],
  next: FlowState,
): {
  next: FlowState;
  shamanBurst: string[];
  needsExplain: boolean;
} {
  const kind = next.disputeKind || next.answers.disputeKind || "general";
  const story = next.answers.disputeStory || next.summary || "";
  const mode = next.answers.solicitorMatchMode;
  const place = next.answers.solicitorLocation;
  const modeNote =
    mode === "local" && place
      ? `We’ll look on the SRA register near ${place}.`
      : mode === "local"
        ? "We’ll look on the SRA register for local firms."
        : mode === "online"
          ? "We’ll look on the SRA register for firms you can approach online."
          : mode === "reviews"
            ? "We’ll look on the SRA register and you can compare public reviews before instructing."
            : "We’ll keep SRA solicitor matches open if you want them later.";

  if (storyIsRichEnough(story)) {
    if (kind === "benefits") {
      const uc = beginUcRightsScreen(messages, next, modeNote);
      return { next: uc.next, shamanBurst: uc.shamanBurst, needsExplain: false };
    }
    const delivered = beginOptionsDelivery(messages, kind);
    const waiting = delivered.shamanBurst[0] || "I’ll share the main options in plain English first…";
    const burst = withBurst(messages, [modeNote, waiting]);
    next.phase = delivered.phase;
    next.messages = burst.messages;
    next.inputHint = delivered.inputHint;
    return {
      next,
      shamanBurst: burst.shamanBurst,
      needsExplain: delivered.needsExplain,
    };
  }

  const q = disputeQuestionAt(kind, 0);
  const ask =
    q?.ask ||
    "In your own words, what should the right person understand first about what happened?";
  const burst = withBurst(messages, [modeNote, ask]);
  next.phase = "dispute_context";
  next.disputeQIndex = 0;
  next.messages = burst.messages;
  next.inputHint = q?.placeholder || "What they need to grasp first…";
  return { next, shamanBurst: burst.shamanBurst, needsExplain: false };
}

function humanAcknowledge(kind: DisputeKind, story: string): string {
  const pack = getDisputePack(kind);
  if (/\b(lawyer|solicitor|barrister|law firm)\b/i.test(story)) {
    return (
      "Thank you — problems with lawyers are common and often need a clear timeline. " +
      "I’ll stay professional and practical while we shape what happened so the right person can help."
    );
  }
  return pack.acknowledge;
}

function appendStory(prior: string | undefined, addition: string): string {
  const a = (prior || "").trim();
  const b = addition.trim();
  if (!a) return b;
  if (a.toLowerCase().includes(b.toLowerCase()) && b.length < a.length) return a;
  return `${a}\n\n${b}`;
}

function freeServicesPrompt(kind: DisputeKind | null): string {
  switch (kind) {
    case "divorce":
      return (
        "Have you already spoken to any free family services — for example a law centre, family clinic, or mediation info service? " +
        MIC
      );
    case "housing":
      return (
        "Have you already spoken to any free housing help — Shelter, a law centre, or a local advice service? " +
        MIC
      );
    case "employment":
      return (
        "Have you already used free work help — ACAS, a union, or a clinic? " + MIC
      );
    case "debt":
      return (
        "Have you already spoken to free debt advice — StepChange-style help, a law centre, or a local adviser? " +
        MIC
      );
    case "benefits":
      return (
        "Have you already used free benefits help — Citizens Advice, a welfare rights service, or a law centre — for this Universal Credit problem? " +
        MIC
      );
    default:
      return (
        "Have you already spoken to any free services that might apply — a law centre, clinic, or national helpline? " +
        MIC
      );
  }
}

function beginOptionsDelivery(
  _messages: FlowMessage[],
  _kind: DisputeKind,
): {
  phase: FlowPhase;
  messages: FlowMessage[];
  inputHint: string;
  needsExplain: boolean;
  shamanBurst: string[];
} {
  const waiting =
    "I’ll set out the main doors in plain English — so you can see who to speak to and what each path involves…";
  return {
    phase: "await_explain",
    messages: [..._messages, { id: mid(), role: "shaman", text: waiting }],
    inputHint: "One moment…",
    needsExplain: true,
    shamanBurst: [waiting],
  };
}

function beginUcRightsScreen(
  messages: FlowMessage[],
  next: FlowState,
  leadIn?: string,
): { next: FlowState; shamanBurst: string[] } {
  const story = next.answers.disputeStory || next.summary || "";
  const stage = detectUcStage(story, next.answers.ucAnswers);
  const qs = ucScreenQuestionsFor(stage);
  next.ucRightsQIndex = 0;
  next.answers.ucAnswers = next.answers.ucAnswers || {};
  const intro =
    "Before options and financing: Universal Credit has rules about what you’re entitled to and how to challenge a decision. " +
    "I’ll explain the law that fits your situation in plain English, then ask a few short questions so we can say whether entitlement or an appeal looks likely, possible, or unlikely — and what doors you still have.";
  const first = qs[0];
  const lines = [leadIn, intro, first?.ask].filter(Boolean) as string[];
  const burst = withBurst(messages, lines);
  next.phase = "uc_rights_screen";
  next.messages = burst.messages;
  next.inputHint = first?.placeholder || "Your answer…";
  return { next, shamanBurst: burst.shamanBurst };
}

function finishUcRightsAndExplain(
  messages: FlowMessage[],
  next: FlowState,
): { next: FlowState; shamanBurst: string[]; needsExplain: boolean } {
  const story = next.answers.disputeStory || next.summary || "";
  const map = buildUniversalCreditMap({
    kind: "benefits",
    story,
    ucAnswers: next.answers.ucAnswers || {},
  });
  if (map) {
    next.answers.ucEntitlementLikelihood = map.entitlementLikelihood;
    next.answers.ucAppealLikelihood = map.appealLikelihood;
    next.answers.ucRightsSummary = [
      map.entitlementSummary,
      map.appealSummary,
      ...map.lawTopics.slice(0, 2).map((t) => `${t.title}: ${t.rightInPlainEnglish}`),
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 2000);
  }

  const rightsBurst = (map?.rightsMessages || []).slice(0, 6);
  const bridge =
    "Next I’ll map your process options (mandatory reconsideration, appeal, and free help) — then financing if you need a solicitor.";
  const burst = withBurst(messages, [...rightsBurst, bridge]);
  next.phase = "await_explain";
  next.messages = burst.messages;
  next.inputHint = "One moment…";
  return { next, shamanBurst: burst.shamanBurst, needsExplain: true };
}

function beginFinancing(
  messages: FlowMessage[],
  kind: DisputeKind | null,
  story?: string,
): {
  phase: FlowPhase;
  messages: FlowMessage[];
  inputHint: string;
  shamanBurst: string[];
} {
  const la = buildLegalAidMap({ kind, story: story || "" });
  const laLead =
    la.screenPriority === "encourage"
      ? `${la.headline} A short screen is worth doing.`
      : la.screenPriority === "educate_then_skip_ok"
        ? `${la.headline} ${la.outOfScopeNote} You can still run a short screen, or skip to other financing.`
        : `${la.headline}`;
  const line =
    `${laLead} We’ll also map the wider financing menu — free advice, insurance/union cover, no win no fee, and specialist funding only if the matter is complex enough. ` +
    "Want a short legal aid check, or are you expecting to pay privately / use free services first? " +
    MIC;
  return {
    phase: "legal_aid_heard",
    messages: [...messages, { id: mid(), role: "shaman", text: line }],
    inputHint:
      la.screenPriority === "educate_then_skip_ok"
        ? "Check anyway / skip to other financing"
        : "Legal aid check / pay privately / free services",
    shamanBurst: [line],
  };
}

function withBurst(
  prior: FlowMessage[],
  shamanTexts: string[],
): { messages: FlowMessage[]; shamanBurst: string[] } {
  const msgs = [...prior];
  for (const text of shamanTexts) {
    msgs.push({ id: mid(), role: "shaman", text });
  }
  return { messages: msgs, shamanBurst: shamanTexts };
}

export type FlowAdvanceResult = {
  state: FlowState;
  shouldPersist: boolean;
  planReady: boolean;
  /** Client should call /api/cases/explain then applyExplanation */
  needsExplain: boolean;
  /** New shaman lines this turn — UI should stagger them after the user message. */
  shamanBurst: string[];
};

export function advanceFlow(state: FlowState, userText: string): FlowAdvanceResult {
  const text = userText.trim();
  if (!text) {
    return {
      state,
      shouldPersist: false,
      planReady: false,
      needsExplain: false,
      shamanBurst: [],
    };
  }

  const messages: FlowMessage[] = [
    ...state.messages,
    { id: mid(), role: "you", text },
  ];
  let next: FlowState = {
    ...state,
    messages,
    answers: {
      ...state.answers,
      disputeAnswers: { ...(state.answers.disputeAnswers || {}) },
    },
  };
  let shouldPersist = false;
  let planReady = false;
  let needsExplain = false;
  let shamanBurst: string[] = [];

  switch (state.phase) {
    case "need_account":
    case "collect_story": {
      const combined = appendStory(next.answers.disputeStory, text);
      next.answers.disputeStory = combined;
      next.title = titleFromStory(combined);
      next.summary = combined;
      const kind = detectDisputeKind(combined);
      next.disputeKind = kind;
      next.answers.disputeKind = kind;
      next.disputeQIndex = 0;
      ensureUkNationFromStory(next);

      const deepenCount = next.answers.storyDeepenCount || 0;
      if (storyNeedsDeepening(combined) && deepenCount < 2) {
        next.answers.storyDeepenCount = deepenCount + 1;
        next.phase = "collect_story";
        const deepen = deepenStoryPrompt(combined);
        const burst = withBurst(messages, [deepen]);
        next.messages = burst.messages;
        shamanBurst = burst.shamanBurst;
        next.inputHint = "Tell me what happened — in your own words";
        shouldPersist = true;
        break;
      }

      const ack = humanAcknowledge(kind, combined);
      const speak = speakToSomeonePrompt(kind);
      const burst = withBurst(messages, [ack, speak]);
      next.phase = "speak_to_someone";
      next.messages = burst.messages;
      shamanBurst = burst.shamanBurst;
      next.inputHint = "Yes — help me find the right person / not yet";
      shouldPersist = true;
      break;
    }

    case "speak_to_someone": {
      next.answers.wantSpeakToSomeone = text;
      // If they keep telling the story instead of yes/no, fold it in.
      if (text.split(/\s+/).length > 12 && !/^(yes|yeah|yep|no|nope|nah)\b/i.test(text)) {
        next.answers.disputeStory = appendStory(next.answers.disputeStory, text);
        next.summary = next.answers.disputeStory;
        next.title = titleFromStory(next.answers.disputeStory || text);
        const refreshed = detectDisputeKind(next.answers.disputeStory || text);
        next.disputeKind = refreshed;
        next.answers.disputeKind = refreshed;
      }

      const interest = yesNoUnsure(text);
      const wantsSolicitor =
        interest === "yes" ||
        /\b(solicitor|lawyer|find someone|speak to|talk to)\b/i.test(text);

      if (wantsSolicitor && interest !== "no") {
        const bridge =
          "Good — we’ll shape this so you can find the right person. I’m not a solicitor; I help you get ready to speak to one.";
        const ask = solicitorMatchModePrompt();
        const burst = withBurst(messages, [bridge, ask]);
        next.phase = "solicitor_match_mode";
        next.messages = burst.messages;
        shamanBurst = burst.shamanBurst;
        next.inputHint = "Local / online / by reviews";
        shouldPersist = true;
        break;
      }

      const kind = next.disputeKind || next.answers.disputeKind || "general";
      const story = next.answers.disputeStory || next.summary || "";
      const bridge =
        interest === "no"
          ? "That’s fine. We’ll still shape your matter clearly so the options make sense when you are ready."
          : "Okay — we’ll keep that open and shape the problem so the right people can help.";

      if (storyIsRichEnough(story)) {
        if (kind === "benefits") {
          const uc = beginUcRightsScreen(messages, next, bridge);
          next = uc.next;
          shamanBurst = uc.shamanBurst;
          needsExplain = false;
        } else {
          const delivered = beginOptionsDelivery(messages, kind);
          const waiting =
            delivered.shamanBurst[0] || "I’ll share the main options in plain English first…";
          const burst = withBurst(messages, [bridge, waiting]);
          next.phase = delivered.phase;
          next.messages = burst.messages;
          shamanBurst = burst.shamanBurst;
          next.inputHint = delivered.inputHint;
          needsExplain = delivered.needsExplain;
        }
      } else {
        const q = disputeQuestionAt(kind, 0);
        const ask =
          q?.ask ||
          "In your own words, what should the right person understand first about what happened?";
        const burst = withBurst(messages, [bridge, ask]);
        next.phase = "dispute_context";
        next.disputeQIndex = 0;
        next.messages = burst.messages;
        shamanBurst = burst.shamanBurst;
        next.inputHint = q?.placeholder || "What they need to grasp first…";
      }
      shouldPersist = true;
      break;
    }

    case "solicitor_match_mode": {
      const mode = parseSolicitorMatchMode(text);
      next.answers.solicitorMatchMode = mode;
      if (mode === "local") {
        const ask =
          "Got it — local. What’s your town or postcode so we can search the SRA register near you? " +
          MIC;
        const burst = withBurst(messages, [ask]);
        next.phase = "solicitor_location";
        next.messages = burst.messages;
        shamanBurst = burst.shamanBurst;
        next.inputHint = "Town or postcode";
      } else {
        const cont = continueAfterSolicitorPrefs(messages, next);
        next = cont.next;
        shamanBurst = cont.shamanBurst;
        needsExplain = cont.needsExplain;
      }
      shouldPersist = true;
      break;
    }

    case "solicitor_location": {
      const place = text.trim();
      if (place.length < 2 || /\b(skip|later|not sure|unsure|don'?t know)\b/i.test(place)) {
        next.answers.solicitorMatchMode = next.answers.solicitorMatchMode || "unsure";
        next.answers.solicitorLocation = undefined;
      } else {
        next.answers.solicitorLocation = place.slice(0, 80);
        next.answers.solicitorMatchMode = "local";
      }
      const cont = continueAfterSolicitorPrefs(messages, next);
      next = cont.next;
      shamanBurst = cont.shamanBurst;
      needsExplain = cont.needsExplain;
      shouldPersist = true;
      break;
    }

    case "dispute_context": {
      const kind = next.disputeKind || next.answers.disputeKind || "general";
      const q = disputeQuestionAt(kind, state.disputeQIndex);
      // Treat answers as story, not form fields — fold into the narrative.
      next.answers.disputeStory = appendStory(next.answers.disputeStory, text);
      next.summary = next.answers.disputeStory;
      if (q) {
        next.answers.disputeAnswers = {
          ...(next.answers.disputeAnswers || {}),
          [q.id]: text,
        };
      }
      // One shaping prompt only — then UC rights (benefits) or options.
      next.disputeQIndex = state.disputeQIndex + 1;
      const lead =
        "That’s enough to shape a clear picture. I’ll set out the main doors in plain English so you can choose who to speak to.";
      if (kind === "benefits") {
        const uc = beginUcRightsScreen(messages, next, lead);
        next = uc.next;
        shamanBurst = uc.shamanBurst;
        needsExplain = false;
      } else {
        const delivered = beginOptionsDelivery(messages, kind);
        const waiting =
          delivered.shamanBurst[0] || "I’ll share the main options in plain English first…";
        const burst = withBurst(messages, [lead, waiting]);
        next.phase = delivered.phase;
        next.messages = burst.messages;
        shamanBurst = burst.shamanBurst;
        next.inputHint = delivered.inputHint;
        needsExplain = delivered.needsExplain;
      }
      shouldPersist = true;
      break;
    }

    case "uc_rights_screen": {
      const story = next.answers.disputeStory || next.summary || "";
      const stage = detectUcStage(story, next.answers.ucAnswers);
      const qs = ucScreenQuestionsFor(stage);
      const idx = state.ucRightsQIndex;
      const current = qs[idx];
      if (current) {
        next.answers.ucAnswers = {
          ...(next.answers.ucAnswers || {}),
          [current.id]: text.slice(0, 500),
        };
      }
      // Allow skip mid-screen
      if (/\b(skip|later|enough|move on)\b/i.test(text) && text.split(/\s+/).length < 8) {
        const done = finishUcRightsAndExplain(messages, next);
        next = done.next;
        shamanBurst = done.shamanBurst;
        needsExplain = done.needsExplain;
        shouldPersist = true;
        break;
      }
      const nextIdx = idx + 1;
      if (nextIdx >= qs.length) {
        const done = finishUcRightsAndExplain(messages, next);
        next = done.next;
        shamanBurst = done.shamanBurst;
        needsExplain = done.needsExplain;
      } else {
        next.ucRightsQIndex = nextIdx;
        const ask = qs[nextIdx]!.ask;
        const burst = withBurst(messages, [ask]);
        next.phase = "uc_rights_screen";
        next.messages = burst.messages;
        shamanBurst = burst.shamanBurst;
        next.inputHint = qs[nextIdx]!.placeholder;
      }
      shouldPersist = true;
      break;
    }

    case "await_explain": {
      const line = "Still putting your options together — hang on. " + MIC;
      const burst = withBurst(messages, [line]);
      next.messages = burst.messages;
      shamanBurst = burst.shamanBurst;
      needsExplain = true;
      break;
    }

    case "options_clarify": {
      next.answers.optionsClarify = text;
      // Honour money / free-services / skip intent even when they also asked for clarify.
      if (
        /\b(money|financ|ready|next|legal aid|privat|pay|done|free service|skip)\b/i.test(text) ||
        !wantsMoreClarify(text)
      ) {
        // Private pay / free services → skip legal aid; legal aid / unclear → offer the check.
        if (
          wantsSkipLegalAid(text) ||
          /\b(free service|free advice|pay(ing)? privately|private(ly)?)\b/i.test(text)
        ) {
          next.fundingKnowledge = "heard";
          next.answers.openToPaying = /\b(pay|privat|self[- ]?fund)/i.test(text)
            ? "yes — expecting to pay privately if needed"
            : next.answers.openToPaying;
          const note = /\b(pay|privat|self[- ]?fund)/i.test(text)
            ? "Understood — we’ll treat this as private pay if you instruct someone, and still map free services first."
            : "Understood — we’ll leave legal aid for now and look at free services.";
          const skipped = skipLegalAidToFreeServices(messages, next, note);
          next = skipped.next;
          shamanBurst = skipped.shamanBurst;
        } else if (/\b(legal aid)\b/i.test(text) && !/\b(no|skip|without)\b/i.test(text)) {
          next.fundingKnowledge = "heard";
          const started = startLegalAidScreen(
            messages,
            next,
            "Okay — a short legal aid check. Answer as best you can; you can skip any time.",
          );
          next = started.next;
          shamanBurst = started.shamanBurst;
        } else {
          const fin = beginFinancing(
            messages,
            next.disputeKind || next.answers.disputeKind || null,
            next.answers.disputeStory || next.summary || "",
          );
          next.phase = fin.phase;
          next.messages = fin.messages;
          shamanBurst = fin.shamanBurst;
          next.inputHint = fin.inputHint;
        }
      } else {
        const kind = next.disputeKind || next.answers.disputeKind || "general";
        const guide = getProcessGuide(kind);
        const extra =
          "Happy to. " +
          guide.processOverview +
          " If one option feels closest, say which — or tell me whether you’d check legal aid or pay privately. " +
          MIC;
        const burst = withBurst(messages, [extra]);
        next.messages = burst.messages;
        shamanBurst = burst.shamanBurst;
        next.inputHint = "Ask about an option / legal aid / pay privately";
      }
      shouldPersist = true;
      break;
    }

    case "legal_aid_heard": {
      next.answers.legalAidHeard = text;
      const knowledge = inferFundingKnowledge(text);
      next.fundingKnowledge = knowledge;

      if (declinesLegalAidOffer(text)) {
        const skipped = skipLegalAidToFreeServices(
          messages,
          next,
          "No problem — skipping the legal aid check.",
        );
        next = skipped.next;
        shamanBurst = skipped.shamanBurst;
      } else if (wantsLegalAidCheck(text) || knowledge === "used_before") {
        const kind = next.disputeKind || next.answers.disputeKind || null;
        if (knowledge === "never_heard") {
          next.phase = "legal_aid_explain";
          const burst = withBurst(messages, [
            legalAidIntroNeverHeard(kind) +
              " You can also say “skip” to go straight to free services.",
          ]);
          next.messages = burst.messages;
          shamanBurst = burst.shamanBurst;
          next.inputHint = "Okay to check / or skip";
        } else {
          const started = startLegalAidScreen(messages, next, legalAidIntroHeard(kind));
          next = started.next;
          shamanBurst = started.shamanBurst;
        }
      } else if (knowledge === "never_heard") {
        const kind = next.disputeKind || next.answers.disputeKind || null;
        next.phase = "legal_aid_explain";
        const burst = withBurst(messages, [
          legalAidIntroNeverHeard(kind) +
            " You can also say “skip” to go straight to free services.",
        ]);
        next.messages = burst.messages;
        shamanBurst = burst.shamanBurst;
        next.inputHint = "Okay to check / or skip";
      } else {
        // Ambiguous — confirm rather than force the questionnaire.
        const burst = withBurst(messages, [
          "Got it. Say “check” for a short legal aid screen, or “skip” for free services and other money options. " +
            MIC,
        ]);
        next.messages = burst.messages;
        shamanBurst = burst.shamanBurst;
        next.inputHint = "Check / skip";
        next.phase = "legal_aid_heard";
      }
      shouldPersist = true;
      break;
    }

    case "legal_aid_explain": {
      if (declinesLegalAidOffer(text)) {
        const skipped = skipLegalAidToFreeServices(
          messages,
          next,
          "Okay — skipping legal aid for now.",
        );
        next = skipped.next;
        shamanBurst = skipped.shamanBurst;
      } else {
        const started = startLegalAidScreen(
          messages,
          next,
          "Here we go — a few short questions. Say “skip” any time to leave the check.",
        );
        next = started.next;
        shamanBurst = started.shamanBurst;
      }
      shouldPersist = true;
      break;
    }

    case "legal_aid_screen": {
      if (wantsSkipLegalAid(text)) {
        const skipped = skipLegalAidToFreeServices(
          messages,
          next,
          "Stopping the legal aid check here — free services next.",
        );
        next = skipped.next;
        shamanBurst = skipped.shamanBurst;
        shouldPersist = true;
        break;
      }

      const kind = next.disputeKind || next.answers.disputeKind || null;
      const qs = legalAidQuestionsFor(kind);
      const current = qs[state.legalAidQIndex];
      const answers = { ...(next.answers.legalAidAnswers || {}) };
      if (current) answers[current.id] = text;
      next.answers.legalAidAnswers = answers;

      const nextIndex = state.legalAidQIndex + 1;
      const nextQ = qs[nextIndex];
      if (nextQ) {
        next.legalAidQIndex = nextIndex;
        next.phase = "legal_aid_screen";
        const burst = withBurst(messages, [nextQ.ask]);
        next.messages = burst.messages;
        shamanBurst = burst.shamanBurst;
        next.inputHint = `${nextQ.placeholder} (or skip)`;
      } else {
        const scored = scoreLegalAidScreen({ kind, answers });
        next.answers.legalAidLikelihood = scored.likelihood;
        next.answers.legalAidSummary = scored.summary;
        next.answers.legalAidQualify = scored.likelihood;
        next.legalAidQIndex = nextIndex;
        const summaryLine = `${scored.summary}${scored.notes.length ? ` ${scored.notes[0]}` : ""}`;
        const cont = beginFreeServicesTried(messages, next, summaryLine);
        next = cont.next;
        shamanBurst = cont.shamanBurst;
      }
      shouldPersist = true;
      break;
    }

    case "uk_nation": {
      next.answers.ukNation = parseUkNation(text);
      const cont = beginFreeServicesTried(
        messages,
        next,
        next.answers.ukNation === "scotland"
          ? "Thanks — we’ll use the Scotland free-advice guide."
          : next.answers.ukNation === "wales"
            ? "Thanks — we’ll use the Wales free-advice guide (devolved law matters for housing and more)."
            : next.answers.ukNation === "england"
              ? "Thanks — we’ll use the England & Wales free-advice guide."
              : "Okay — we’ll use the England & Wales guide as a default; say if you’re in Scotland or Wales later.",
      );
      // beginFreeServicesTried will re-ask uk_nation if still unknown — force free services once answered.
      if (cont.next.phase === "uk_nation") {
        next.phase = "free_services_tried";
        const kind = next.disputeKind || next.answers.disputeKind || null;
        const freeQ = freeServicesPrompt(kind);
        const burst = withBurst(messages, [
          "Okay — we’ll map free doors with the England & Wales guide as a starting point.",
          freeQ,
        ]);
        next.messages = burst.messages;
        shamanBurst = burst.shamanBurst;
        next.inputHint = "Yes, no, or say which service";
      } else {
        next = cont.next;
        shamanBurst = cont.shamanBurst;
      }
      shouldPersist = true;
      break;
    }

    case "free_services_tried": {
      next.answers.freeServicesTried = text;
      next.phase = "free_advice_first";
      const burst = withBurst(messages, [
        "Would you prefer free advice first before paying anyone — law centre, clinic, or helpline? " + MIC,
      ]);
      next.messages = burst.messages;
      shamanBurst = burst.shamanBurst;
      next.inputHint = "Yes, no, or speak into the mic";
      shouldPersist = true;
      break;
    }

    case "free_advice_first": {
      next.answers.freeAdviceFirst = text;
      next.phase = "open_to_paying";
      const burst = withBurst(messages, [
        "If free routes aren’t enough, a short paid fixed-fee chat can help once your papers are ready. Open to that? " +
          MIC,
      ]);
      next.messages = burst.messages;
      shamanBurst = burst.shamanBurst;
      next.inputHint = "Yes, no, or later";
      shouldPersist = true;
      break;
    }

    case "open_to_paying": {
      next.answers.openToPaying = text;
      next.phase = "insurance_cover";
      const burst = withBurst(messages, [
        "Last money check: legal expenses insurance, a union, or employer cover can pay before you do. Any of those? " +
          MIC,
      ]);
      next.messages = burst.messages;
      shamanBurst = burst.shamanBurst;
      next.inputHint = "Yes / no — mic welcome";
      shouldPersist = true;
      break;
    }

    case "insurance_cover": {
      next.answers.insuranceCover = text;
      const preference = resolvePreference(next.answers);
      next.fundingPreference = preference;
      next.fundingNotes = [
        next.answers.wantSpeakToSomeone,
        next.answers.legalAidHeard,
        next.answers.legalAidQualify,
        next.answers.freeServicesTried,
        next.answers.freeAdviceFirst,
        next.answers.openToPaying,
        next.answers.insuranceCover,
      ]
        .filter(Boolean)
        .join(" · ");
      const building = "Building your plan now — options, financing map, and who can help…";
      const doneLine =
        "Here’s your plan of action. We signpost and map the claim path and financing; we don’t replace a solicitor. Saved under Your case.";
      const plan = buildActionPlan({
        story: next.answers.disputeStory || next.summary,
        title: next.title,
        fundingKnowledge: next.fundingKnowledge,
        fundingPreference: preference,
        answers: next.answers,
        disputeKind: next.disputeKind || next.answers.disputeKind || null,
        optionsExplanation: next.optionsExplanation,
      });
      next.actionPlan = plan;
      next.phase = "done";
      const burst = withBurst(messages, [building, doneLine]);
      next.messages = burst.messages;
      shamanBurst = burst.shamanBurst;
      next.inputHint = "Anything to add? Use the mic or upload a letter";
      shouldPersist = true;
      planReady = true;
      break;
    }

    case "building_plan":
    case "done": {
      const burst = withBurst(messages, [
        "Your plan is on Your case. You can upload letters or photos below, or tell me what changed. " + MIC,
      ]);
      next.messages = burst.messages;
      shamanBurst = burst.shamanBurst;
      next.inputHint = "Add a note or upload a document";
      break;
    }
  }

  return { state: next, shouldPersist, planReady, needsExplain, shamanBurst };
}

/**
 * Apply server-built explanation as separate short turns (not one dump),
 * then ask how they’d fund help — legal aid vs paying — instead of dumping money notes.
 */
export function applyExplanation(
  state: FlowState,
  explanation: string | string[],
): FlowState {
  const lines = (
    Array.isArray(explanation)
      ? explanation
      : explanation
          .split(/\n\n+/)
          .map((s) => s.trim())
          .filter(Boolean)
  )
    .map((s) => s.trim())
    .filter(Boolean);

  const optionLines =
    lines.length > 0 ? lines : ["Here are the usual options in plain English."];

  const financeAsk =
    "Next we map financing — from free doors and legal aid through to private solicitor costs if you instruct someone. For complex claims that map is especially important. Would you expect to check legal aid, or pay privately? You can also ask me to clarify any option first. " +
    MIC;

  const burst = withBurst(state.messages, [...optionLines, financeAsk]);
  const stored = optionLines.join("\n\n");
  return {
    ...state,
    optionsExplanation: stored,
    answers: {
      ...state.answers,
      optionsExplanation: stored,
    },
    phase: "options_clarify",
    messages: burst.messages,
    inputHint: "Clarify an option / legal aid / pay privately",
  };
}

/** Sync fallback options when explain API is slow — used by the client timeout path. */
export function localOptionsExplanation(state: FlowState): string[] {
  const kind = state.disputeKind || state.answers.disputeKind || "general";
  return formatOptionsMessages(getProcessGuide(kind));
}

/** Single-string fallback for storage / older callers. */
export function localOptionsExplanationText(state: FlowState): string {
  return formatOptionsForChat(getProcessGuide(
    state.disputeKind || state.answers.disputeKind || "general",
  ));
}

export function shamanPromptForPhase(state: FlowState): string {
  if (state.inputHint) return state.inputHint;
  return "Tap the mic if speaking is easier";
}

/** Typing delay in ms for a shaman line (feels human, stays snappy). */
export function typingDelayMs(text: string): number {
  const len = text.trim().length;
  return Math.min(2200, Math.max(450, Math.round(len * 12)));
}
