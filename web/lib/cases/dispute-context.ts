/**
 * Soft clarifying prompts — used sparingly after we already have the story.
 * Tone: human adviser shaping a matter so the client can find the right people.
 */

export type DisputeKind =
  | "divorce"
  | "housing"
  | "employment"
  | "consumer"
  | "debt"
  | "neighbour"
  | "benefits"
  | "general";

export type DisputeQuestion = {
  id: string;
  /** Short spoken/typed prompt */
  ask: string;
  /** Placeholder on the input */
  placeholder: string;
  /** Guidance source this question reflects */
  sourceHint: string;
};

export type DisputePack = {
  kind: DisputeKind;
  acknowledge: string;
  questions: DisputeQuestion[];
};

const DIVORCE: DisputePack = {
  kind: "divorce",
  acknowledge:
    "I’m sorry you’re carrying that. Most people in your position want a calm human to talk it through — we’ll shape what happened so the right person can help.",
  questions: [
    {
      id: "divorce_shape",
      ask:
        "What should that person grasp first — children, money, safety, or simply ending the marriage? Say it in your own words.",
      placeholder: "Children, money, safety, ending the marriage…",
      sourceHint: "gov.uk/divorce",
    },
  ],
};

const HOUSING: DisputePack = {
  kind: "housing",
  acknowledge:
    "Housing stress is real. We’ll shape this so you can find the right housing adviser or solicitor — not fill a form.",
  questions: [
    {
      id: "housing_shape",
      ask:
        "What matters most right now — keeping a roof, getting a deposit back, repairs, or challenging a notice? Tell me in a sentence or two.",
      placeholder: "Roof, deposit, repairs, notice…",
      sourceHint: "gov.uk/housing",
    },
  ],
};

const EMPLOYMENT: DisputePack = {
  kind: "employment",
  acknowledge:
    "Work disputes wear people down. We’ll get the story clear enough that the right employment person can pick it up.",
  questions: [
    {
      id: "employment_shape",
      ask:
        "What do you most need help with — unfair treatment, pay, dismissal, or something else? A short version is enough.",
      placeholder: "Treatment, pay, dismissal…",
      sourceHint: "gov.uk/solve-workplace-dispute",
    },
  ],
};

const CONSUMER: DisputePack = {
  kind: "consumer",
  acknowledge:
    "Got it. We’ll pin down what went wrong so you can find the right consumer help — not a checklist.",
  questions: [
    {
      id: "consumer_shape",
      ask:
        "What outcome are you after — refund, repair, or chasing someone who won’t respond? Say what happened in plain words.",
      placeholder: "Refund, repair, no response…",
      sourceHint: "gov.uk/consumer-protection-rights",
    },
  ],
};

const DEBT: DisputePack = {
  kind: "debt",
  acknowledge:
    "You’re not alone with this. We’ll shape the pressure you’re under so debt advice or the right firm can step in.",
  questions: [
    {
      id: "debt_shape",
      ask:
        "What’s pressing hardest — letters, bailiffs, a court date, or just not knowing where to start?",
      placeholder: "Letters, bailiffs, court, unsure…",
      sourceHint: "gov.uk/options-for-paying-off-your-debts",
    },
  ],
};

const NEIGHBOUR: DisputePack = {
  kind: "neighbour",
  acknowledge:
    "Neighbour rows drain people. We’ll get a clear picture so the right local help can take it from here.",
  questions: [
    {
      id: "neighbour_shape",
      ask:
        "What should someone helping you understand first — noise, access, boundary, safety, or something else?",
      placeholder: "Noise, access, boundary, safety…",
      sourceHint: "gov.uk/how-to-resolve-neighbour-disputes",
    },
  ],
};

const BENEFITS: DisputePack = {
  kind: "benefits",
  acknowledge:
    "Benefits decisions are stressful and time-sensitive. We’ll shape what’s wrong with the Universal Credit (or related) decision so free advice can help you challenge it.",
  questions: [
    {
      id: "benefits_shape",
      ask:
        "What should someone helping you grasp first — a refused or wrong UC amount, a sanction, an overpayment, a missing payment, or an appeal already underway?",
      placeholder: "Wrong amount, sanction, overpayment, missing pay, appeal…",
      sourceHint: "gov.uk/mandatory-reconsideration",
    },
  ],
};

const GENERAL: DisputePack = {
  kind: "general",
  acknowledge:
    "Thank you for trusting me with that. Most people want to speak to a person — I’ll help shape your problem so we can find the right ones.",
  questions: [
    {
      id: "general_shape",
      ask:
        "If you could sit with the right adviser tomorrow, what should they understand first about what happened?",
      placeholder: "What they need to grasp first…",
      sourceHint: "general",
    },
  ],
};

export function detectDisputeKind(story: string): DisputeKind {
  const t = story.toLowerCase();
  if (/\b(divorce|dissolution|separat(?:e|ing|ion)|ex[- ]?(?:husband|wife|spouse)|end(ing)? (our |the )?marriage)\b/.test(t)) {
    return "divorce";
  }
  if (
    /\b(landlord|tenant|deposit|evict|rent arrears|housing association|section 21|section 8|disrepair)\b/.test(t)
  ) {
    return "housing";
  }
  if (/\b(employer|dismiss|fired|redundan|workplace|wages?|payslip|tribunal|acas)\b/.test(t)) {
    return "employment";
  }
  if (/\b(refund|faulty|bought|seller|delivery|consumer|guarantee|warranty)\b/.test(t)) {
    return "consumer";
  }
  if (
    /\b(universal credit|\buc\b|uc (?:claim|appeal|sanction|journal|payment)|dwp|mandatory reconsideration|benefits? (?:appeal|sanction|tribunal)|pip (?:appeal|refused)|esa (?:appeal|refused))\b/.test(
      t,
    )
  ) {
    return "benefits";
  }
  if (/\b(debt|bailiff|collector|owes? money|credit card|loan arrears)\b/.test(t)) {
    return "debt";
  }
  if (/\b(neighbour|neighbor|boundary|fence|noise complaint|shared drive)\b/.test(t)) {
    return "neighbour";
  }
  return "general";
}

/** True when the client named a category but hasn’t told the story yet. */
export function storyNeedsDeepening(story: string): boolean {
  const cleaned = story.replace(/\s+/g, " ").trim();
  if (!cleaned) return true;
  const words = cleaned.split(" ").filter(Boolean);
  const t = cleaned.toLowerCase();

  const mentionsLawyer =
    /\b(lawyer|solicitor|barrister|law firm|legal (?:aid )?advisor|legal adviser)\b/.test(t);
  const hasNarrativeCue =
    /\b(said|told|did|didn't|did not|charged|missed|ignored|delay|delayed|complaint|complain|negligen|fee|fees|letter|email|court|hearing|meeting|called|refused|promise|agreed|weeks?|months?|years?|because|when|after|before|then)\b/.test(
      t,
    );

  if (words.length < 14) return true;
  if (mentionsLawyer && !hasNarrativeCue && words.length < 40) return true;

  // “I have a problem with X” without substance
  if (
    /\b(problem|issue|trouble|help)\b/.test(t) &&
    !hasNarrativeCue &&
    words.length < 28
  ) {
    return true;
  }

  return false;
}

export function deepenStoryPrompt(story: string): string {
  const t = story.toLowerCase();
  const mic = "Tap the mic if speaking is easier.";

  if (/\b(lawyer|solicitor|barrister|law firm)\b/.test(t)) {
    return (
      "I hear you — a problem with a lawyer needs the story, not a form. " +
      "What actually happened? When did it start, what did they do or fail to do, and what do you want put right? " +
      mic
    );
  }
  if (/\b(divorce|separat)/.test(t)) {
    return (
      "Okay. Tell me what happened — what’s going on between you, and what you most need help with right now. " +
      mic
    );
  }
  if (/\b(landlord|tenant|evict|housing|deposit)/.test(t)) {
    return (
      "Got it. Walk me through what happened with the housing side — notices, letters, what’s at risk. " + mic
    );
  }
  if (/\b(employer|work|job|dismiss|fired)/.test(t)) {
    return (
      "Understood. What happened at work, and what do you need someone to help you with? " + mic
    );
  }
  if (/\b(universal credit|\buc\b|dwp|benefit|sanction|mandatory reconsideration)\b/.test(t)) {
    return (
      "Okay — benefits clocks matter. What did DWP decide, when was the decision, and what do you want put right (amount, sanction, overpayment, or something else)? " +
      mic
    );
  }
  return (
    "I’m with you. Tell me the story of what happened — who was involved, what went wrong, and what you want next. " +
    "We’ll shape it so you can find the right people. " +
    mic
  );
}

export function getDisputePack(kind: DisputeKind): DisputePack {
  switch (kind) {
    case "divorce":
      return DIVORCE;
    case "housing":
      return HOUSING;
    case "employment":
      return EMPLOYMENT;
    case "consumer":
      return CONSUMER;
    case "debt":
      return DEBT;
    case "neighbour":
      return NEIGHBOUR;
    case "benefits":
      return BENEFITS;
    default:
      return GENERAL;
  }
}

export function disputeQuestionAt(kind: DisputeKind, index: number): DisputeQuestion | null {
  const pack = getDisputePack(kind);
  return pack.questions[index] ?? null;
}

/** Rich enough that we can skip the single shaping question. */
export function storyIsRichEnough(story: string): boolean {
  const words = story.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length >= 45) return true;
  if (words.length >= 28 && !storyNeedsDeepening(story)) return true;
  return false;
}
