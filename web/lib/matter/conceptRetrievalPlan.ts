/**
 * Concept-planned retrieval for the compiled Legal Shaman wiki.
 *
 * Papers / patterns this implements:
 * - LexKeyPlan (ACL 2025): plan retrieval from keyphrases, not a single domain blob
 * - Intent Taxonomy of Legal Case Retrieval: multi-intent slots over one coarse domain
 * - MuISQA / DMQR-RAG: emit several intents; fuse hits
 * - Karpathy LLM Wiki / WiCER: wiki is the compiled store; this module only navigates it
 *
 * Design rule: add a concept cluster (or rely on raw keyphrases) — do NOT add a new
 * sense detector + frame for every matter shape.
 */

import type { MatterFrame } from "./types";
import { ISSUE_RETRIEVAL_INTENTS } from "./scopes";

export type ConceptRetrievalPlan = {
  /** Merged frame + story keyphrases used for planning. */
  concepts: string[];
  /** Multi-intent search queries for the wiki. */
  intents: string[];
  /** Title patterns to drop when ranking hits. */
  titleExclusions: RegExp[];
  /** Matched cluster ids (empty when only raw keyphrases fired). */
  clusterIds: string[];
  /** When set, skip default ISSUE_RETRIEVAL_INTENTS for these slugs. */
  suppressSlugDefaults: string[];
  source: "concept-plan";
};

type ConceptCluster = {
  id: string;
  /** All must match the story+concepts blob. */
  matchAll: RegExp[];
  /** At least one must match (when set). */
  matchAny?: RegExp[];
  /** If any match, this cluster does not fire (bleed guard). */
  rejectIf?: RegExp[];
  intents: string[];
  titleExclusion?: RegExp;
  /** Coarse slugs whose hard-coded default intents would bleed. */
  suppressSlugDefaults?: string[];
};

/**
 * Concept clusters ≈ legal retrieval intents, not UI frames.
 * Order: more specific shapes first. Prefer adding a cluster here over `looksX` + frames.
 */
const CONCEPT_CLUSTERS: ConceptCluster[] = [
  // —— Employment leaves (before bare employment defaults) ——
  {
    id: "disability_absence_adjustments",
    matchAll: [
      /\b(employer|employee|at work|workplace|retail|hr\b|my (?:job|work))\b/i,
      /\b(bradford factor|sickness absence|absence (?:management|procedure|trigger|score)|attendance (?:trigger|management)|disability[- ]related (?:sickness|absence)|reasonable adjustments?)\b/i,
    ],
    matchAny: [
      /\b(disabilit(?:y|ies)|disabled|equality act|fluctuating|chronic migraine|epilepsy|bradford)\b/i,
    ],
    intents: [
      "disability discrimination reasonable adjustments Equality Act",
      "sickness absence management disability Bradford Factor",
      "reasonable adjustments disability-related absence",
      "employer absence procedure disabled employees ACAS",
    ],
    titleExclusion:
      /schedule of loss|unfair dismissal claim|bullying at work|zero hours contracts|how to win a grievance|value a claim for employment tribunal/i,
    suppressSlugDefaults: ["employment"],
  },
  {
    id: "pregnancy_maternity_redundancy",
    matchAll: [
      /\b(pregnant|pregnancy|maternity|shared parental)\b/i,
      /\b(redundan|dismiss|sacked|fired|employer|job|work)\b/i,
    ],
    intents: [
      "pregnancy maternity redundancy rights ACAS",
      "maternity leave dismissal unfair",
      "pregnant employee redundancy Equality Act",
    ],
    titleExclusion: /bradford factor|used car|parking ticket|neighbour driveway/i,
    suppressSlugDefaults: ["employment"],
  },
  {
    id: "workplace_harassment_bullying",
    matchAll: [
      /\b(employer|at work|workplace|manager|colleague|hr\b)\b/i,
      /\b(harass|bully|bullied|discrimination|discriminat|protected characteristic)\b/i,
    ],
    rejectIf: [
      /\bbradford factor|sickness absence|disability[- ]related absence|reasonable adjustments?.{0,40}absence\b/i,
    ],
    intents: [
      "workplace bullying harassment ACAS",
      "discrimination at work Equality Act",
      "grievance harassment employer",
    ],
    titleExclusion: /schedule of loss|bradford factor|used car|parking ticket/i,
    suppressSlugDefaults: ["employment"],
  },
  {
    id: "employment_unfair_dismissal",
    matchAll: [
      /\b(dismissed|sacked|fired|unfair dismissal|constructive dismissal|made redundant|redundancy)\b/i,
      /\b(employer|job|work|employment|tribunal|acas)\b/i,
    ],
    rejectIf: [/\bbradford factor|disability[- ]related absence|reasonable adjustments?.{0,40}absence\b/i],
    intents: [
      "unfair dismissal employment tribunal ACAS",
      "constructive dismissal employee rights",
      "redundancy rights ACAS",
    ],
    titleExclusion: /bradford factor|used car|parking ticket|neighbour driveway|visa refusal/i,
  },
  {
    id: "employment_wages_hours",
    matchAll: [
      /\b(employer|job|work|manager|shift|hr\b)\b/i,
      /\b(unpaid (?:wage|overtime|holiday)|holiday (?:pay|hours)|national minimum wage|working time|rest breaks?|wage|wages)\b/i,
    ],
    rejectIf: [/\b(dismissed|sacked|fired|bradford factor)\b/i],
    intents: [
      "unpaid wages holiday pay ACAS",
      "working time rest breaks employment",
      "national minimum wage employer",
    ],
    titleExclusion: /schedule of loss|unfair dismissal claim|used car|parking ticket/i,
    suppressSlugDefaults: ["employment"],
  },

  // —— Housing / property ——
  {
    id: "neighbour_access",
    matchAll: [
      /\b(neighbour|neighbor)\b/i,
      /\b(driveway|car\s*port|carport|park(?:ed|ing)|boundary|right of way|easement|blocking|fence|noise|trees?|hedge)\b/i,
    ],
    intents: [
      "neighbour dispute boundary planning",
      "right of way driveway access",
      "neighbour parking driveway dispute",
      "problems with neighbours Citizens Advice",
    ],
    titleExclusion:
      /used car|Consumer Rights Act|faulty goods|landlord repairs|section\s*21|tenancy deposit|unfair dismissal/i,
    suppressSlugDefaults: ["housing", "consumer", "consumer_vehicle_repair", "employment"],
  },
  {
    id: "own_property_use",
    matchAll: [
      /\b(my (?:own )?driveway|on my driveway|wash (?:my )?car|park(?:ing)? on my (?:own )?(?:drive|property)|what (?:can|am) i (?:allowed|able) to .{0,40}(?:driveway|property))\b/i,
    ],
    rejectIf: [/\b(neighbour|neighbor|blocked my|blocking my)\b/i],
    intents: [
      "using your own driveway property rights",
      "parking on your own property",
      "neighbour disputes overview",
    ],
    titleExclusion: /used car reject|faulty goods|section\s*21|unfair dismissal|POPLA/i,
    suppressSlugDefaults: ["housing", "neighbour_dispute", "consumer", "employment"],
  },
  {
    id: "landlord_disrepair",
    matchAll: [
      /\b(landlord|tenant|tenancy|council (?:house|flat)|housing association|renting)\b/i,
      /\b(mould|mold|damp|disrepair|repair|leak|heating|boiler|bed.?bugs?)\b/i,
    ],
    rejectIf: [/\b(neighbour|neighbor).{0,30}(driveway|carport|boundary)\b/i],
    intents: [
      "housing disrepair mould landlord repair",
      "getting repairs done landlord tenant",
      "complaining about landlord repairs",
    ],
    titleExclusion: /used car|neighbour driveway|parking ticket|unfair dismissal|visa/i,
    suppressSlugDefaults: ["neighbour_dispute", "consumer", "employment"],
  },
  {
    id: "landlord_eviction_section21",
    matchAll: [
      /\b(landlord|tenant|tenancy|renting)\b/i,
      /\b(section\s*21|section\s*8|evict|eviction|notice to quit|leave (?:the )?(?:property|flat|house))\b/i,
    ],
    intents: [
      "section 21 notice tenant eviction",
      "eviction process private tenant",
      "challenging a section 21 notice",
    ],
    titleExclusion: /used car|neighbour driveway|parking ticket|unfair dismissal/i,
    suppressSlugDefaults: ["neighbour_dispute", "consumer", "employment"],
  },
  {
    id: "tenancy_deposit",
    matchAll: [
      /\b(deposit|tenancy deposit|dps|mydeposits|tds)\b/i,
      /\b(landlord|tenant|tenancy|flat|rent)\b/i,
    ],
    intents: [
      "tenancy deposit dispute protection scheme",
      "get my deposit back landlord",
      "tenancy deposit scheme complaint",
    ],
    titleExclusion: /used car|parking ticket|unfair dismissal|visa refusal/i,
    suppressSlugDefaults: ["neighbour_dispute", "employment"],
  },
  {
    id: "conveyancing_misrepresentation",
    matchAll: [
      /\b(flat|house|property|leasehold|freehold|conveyanc|buying|purchase)\b/i,
      /\b(estate agent|misrepresent|surveyor|cladding|demolition|service charge|sale fell through)\b/i,
    ],
    rejectIf: [/\b(used car|garage repair|landlord mould)\b/i],
    intents: [
      "property misrepresentation claims",
      "buying and selling a home estate agent",
      "complaining about estate agent",
      "what to do if your house sale falls through",
    ],
    titleExclusion: /used car|parking ticket|unfair dismissal|neighbour driveway|visa/i,
    suppressSlugDefaults: ["consumer", "employment", "housing"],
  },

  // —— Consumer / parking / vehicles ——
  {
    id: "used_car_reject",
    matchAll: [
      /\b(used car|bought .{0,30}(?:car|vehicle)|dealer|trader|motorhouse|car supermarket)\b/i,
      /\b(reject|faulty|repair|refund|Consumer Rights|CRA|broke down|short.?term right)\b/i,
    ],
    rejectIf: [/\b(neighbour|neighbor|driveway|garage charged|mechanic)\b/i],
    intents: [
      "rejecting a faulty used car Consumer Rights Act",
      "buying a used car problem trader refund",
      "Motor Ombudsman faulty vehicle",
      "problem with a used car Citizens Advice",
    ],
    titleExclusion: /neighbour|driveway|parking ticket|unfair dismissal|section\s*21|visa/i,
    suppressSlugDefaults: ["employment", "housing", "neighbour_dispute"],
  },
  {
    id: "garage_vehicle_repair",
    matchAll: [
      /\b(garage|mechanic|main dealer|MOT|works? van)\b/i,
      /\b(repair|repaired|workmanship|poor (?:service|work)|charged|invoice|coolant|engine)\b/i,
    ],
    rejectIf: [/\b(bought .{0,20}(?:used )?car|reject the car|short.?term right to reject)\b/i],
    intents: [
      "problem with a car repair garage consumer",
      "poor workmanship reasonable skill and care",
      "buying or repairing a car consumer",
    ],
    titleExclusion: /unfair dismissal|neighbour driveway|section\s*21|visa refusal/i,
    suppressSlugDefaults: ["employment", "housing"],
  },
  {
    id: "private_parking_pcn",
    matchAll: [
      /\b(pcn|parking (?:ticket|fine|charge)|popla|private (?:car\s*)?park|penalty charge)\b/i,
    ],
    rejectIf: [/\b(neighbour|neighbor).{0,40}(driveway|carport|blocked)\b/i],
    intents: [
      "appealing a parking ticket",
      "penalty charge notice council PCN",
      "POPLA private parking appeal",
      "London Tribunals parking appeal",
    ],
    titleExclusion: /employment|working time|unfair dismissal|used car bought|section\s*21/i,
    suppressSlugDefaults: ["employment", "housing"],
  },
  {
    id: "consumer_faulty_goods",
    matchAll: [
      /\b(bought|purchase|amazon|ebay|online|shop|retailer|seller)\b/i,
      /\b(faulty|broken|refund|return|guarantee|warranty|doesn'?t work|not as described)\b/i,
    ],
    rejectIf: [
      /\b(used car|garage|mechanic|landlord|neighbour|employer|visa|section\s*21)\b/i,
    ],
    intents: [
      "consumer rights faulty goods refund",
      "something gone wrong with a purchase",
      "Consumer Rights Act goods remedies",
    ],
    titleExclusion: /unfair dismissal|neighbour driveway|parking ticket|visa|section\s*21/i,
    suppressSlugDefaults: ["employment", "housing"],
  },
  {
    id: "consumer_services_trader",
    matchAll: [
      /\b(builder|plumber|electrician|tiler|tradesman|trader|contractor|cleaner)\b/i,
      /\b(poor (?:service|work)|workmanship|cancelled|cancellation|quote|invoice|incomplete)\b/i,
    ],
    intents: [
      "problems with services or traders",
      "poor service trader complaint consumer",
      "cancelling a service you've arranged",
    ],
    titleExclusion: /unfair dismissal|neighbour driveway|visa refusal|section\s*21/i,
    suppressSlugDefaults: ["employment", "housing"],
  },
  {
    id: "family_belongings_claim",
    matchAll: [
      /\b(belongings|broke|broken|threw|damaged|switch|console|toy|gift|personal property)\b/i,
      /\b(ex|partner|boyfriend|girlfriend|husband|wife|family|sue|claim|money|replace|compensation)\b/i,
    ],
    rejectIf: [/\b(child arrangements|custody|contact order|visa|section\s*21)\b/i],
    intents: [
      "deciding whether to make a small claim",
      "letter before action money claim",
      "household items and personal belongings compensation",
      "small claims court damaged property",
    ],
    titleExclusion:
      /child arrangements|custody|contact order|types of court orders in family|visa refusal|unfair dismissal/i,
    suppressSlugDefaults: ["family", "employment", "housing"],
  },

  // —— Immigration ——
  {
    id: "family_visa_apply",
    matchAll: [
      /\b(spouse visa|partner visa|family visa|fiancé|fiance|apply for .{0,30}visa|want to apply|applying for|how (?:do|can) i (?:get|apply))\b/i,
    ],
    matchAny: [/\b(visa|spouse|partner|fiancé|fiance|settlement)\b/i],
    rejectIf: [
      /\b(visa (?:was |has been )?refused|refusal (?:letter|decision|notice)|rejected my (?:visa|application)|appeal (?:the |my )?refusal|administrative review)\b/i,
    ],
    intents: [
      "family visa partner spouse application GOV.UK",
      "applying for a spouse or partner visa",
      "financial requirement family visa",
    ],
    titleExclusion: /visa refusal appeal|unfair dismissal|used car|neighbour driveway/i,
    suppressSlugDefaults: ["employment", "consumer", "housing"],
  },
  {
    id: "visa_refusal_challenge",
    matchAll: [
      /\b(visa|leave to remain|entry clearance|home office|immigration)\b/i,
      /\b(visa (?:was |has been )?refused|refusal (?:letter|decision|notice)|rejected my (?:visa|application)|appeal (?:the |my )?refusal|administrative review|challenge (?:the |a )?refusal)\b/i,
    ],
    intents: [
      "visa refusal immigration appeal",
      "challenging a Home Office visa decision",
      "administrative review visa refusal",
    ],
    titleExclusion: /unfair dismissal|used car|neighbour driveway|section\s*21|bradford/i,
    suppressSlugDefaults: ["employment", "consumer", "housing"],
  },

  // —— Family (court) / debt / crime ——
  {
    id: "family_children_arrangements",
    matchAll: [
      /\b(child|children|son|daughter)\b/i,
      /\b(contact|custody|child arrangements|reside|weekend|school run|Cafcass)\b/i,
    ],
    rejectIf: [/\b(belongings|broke my|threw|visa|used car)\b/i],
    intents: [
      "child arrangements contact order",
      "making child arrangements after separation",
      "Cafcass child arrangements",
    ],
    titleExclusion: /small claim|letter before action|visa refusal|unfair dismissal|used car/i,
    suppressSlugDefaults: ["consumer_small_claims", "employment", "consumer"],
  },
  {
    id: "family_divorce_finances",
    matchAll: [/\b(divorce|separat(?:e|ion|ed)|dissolution)\b/i],
    matchAny: [/\b(finances|financial remedy|ancillary|assets|maintenance|clean break)\b/i],
    intents: [
      "divorce finances family court",
      "financial remedy divorce",
      "sorting out money and property divorce",
    ],
    titleExclusion: /visa refusal|unfair dismissal|used car|parking ticket/i,
    suppressSlugDefaults: ["employment", "consumer"],
  },
  {
    id: "debt_bailiff_enforcement",
    matchAll: [
      /\b(bailiff|enforcement officer|debt collector|ccj|county court judgment|charging order)\b/i,
    ],
    intents: [
      "bailiff debt creditor rights",
      "what bailiffs can take",
      "county court judgment CCJ debt",
    ],
    titleExclusion: /unfair dismissal|used car|visa refusal|neighbour driveway/i,
    suppressSlugDefaults: ["employment", "consumer", "housing"],
  },
  {
    id: "motoring_disqualification",
    matchAll: [
      /\b(speeding|penalty points|totting|exceptional hardship|driving (?:ban|disqualification)|disqualified)\b/i,
    ],
    rejectIf: [/\b(pcn|parking ticket|private car park|popla)\b/i],
    intents: [
      "driving ban disqualification motoring",
      "exceptional hardship penalty points",
      "speeding penalty points court",
    ],
    titleExclusion: /unfair dismissal|used car reject|neighbour driveway|visa/i,
    suppressSlugDefaults: ["employment", "consumer", "parking_pcn"],
  },
];

/** Exported for traps / docs — cluster ids in match order. */
export function listConceptClusterIds(): string[] {
  return CONCEPT_CLUSTERS.map((c) => c.id);
}

const STOP = new Set([
  "about",
  "after",
  "again",
  "being",
  "could",
  "would",
  "should",
  "their",
  "there",
  "these",
  "those",
  "which",
  "where",
  "while",
  "still",
  "other",
  "into",
  "from",
  "have",
  "has",
  "had",
  "been",
  "were",
  "with",
  "that",
  "this",
  "your",
  "youre",
  "they",
  "them",
  "then",
  "than",
  "when",
  "what",
  "some",
  "such",
  "only",
  "also",
  "just",
  "like",
  "make",
  "made",
  "very",
  "much",
  "more",
  "most",
  "many",
  "does",
  "did",
  "doing",
  "because",
  "through",
  "before",
  "between",
  "under",
  "over",
  "again",
  "further",
  "once",
  "here",
  "hers",
  "himself",
  "herself",
  "itself",
  "ourselves",
  "yourselves",
  "themselves",
  "examples",
  "looking",
  "mainly",
  "particularly",
  "people",
  "including",
  "several",
  "already",
  "understand",
  "isnt",
  "dont",
  "doesnt",
]);

/** LexKeyPlan-style keyphrases from the citizen story. */
export function extractStoryKeyphrases(story: string, limit = 14): string[] {
  const text = story.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const out = new Set<string>();

  // Multi-word legal / policy phrases that should stay intact
  const compounds = [
    /\bbradford factor\b/gi,
    /\breasonable adjustments?\b/gi,
    /\bdisability[- ]related (?:sickness|absence)\b/gi,
    /\bsickness absence\b/gi,
    /\bequality act\b/gi,
    /\bunfair dismissal\b/gi,
    /\bconstructive dismissal\b/gi,
    /\bemployment tribunal\b/gi,
    /\bconsumer rights act\b/gi,
    /\bsection\s*21\b/gi,
    /\bsection\s*8\b/gi,
    /\bpenalty charge notice\b/gi,
    /\bright of way\b/gi,
    /\btenancy deposit\b/gi,
    /\bchild arrangements\b/gi,
    /\bfamily visa\b/gi,
    /\bspouse visa\b/gi,
    /\bpartner visa\b/gi,
    /\bvisa refusal\b/gi,
    /\bletter before action\b/gi,
    /\bsmall claims?\b/gi,
    /\bnational minimum wage\b/gi,
    /\bholiday pay\b/gi,
    /\bexceptional hardship\b/gi,
  ];
  for (const re of compounds) {
    for (const m of text.matchAll(re)) {
      out.add(m[0]!.toLowerCase());
    }
  }

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9'+\-\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !STOP.has(w));

  for (let i = 0; i < words.length - 1 && out.size < limit; i++) {
    out.add(`${words[i]} ${words[i + 1]}`);
  }
  for (const w of words) {
    if (out.size >= limit) break;
    if (w.length >= 7) out.add(w);
  }

  return [...out].slice(0, limit);
}

function clusterMatches(cluster: ConceptCluster, blob: string): boolean {
  if (!cluster.matchAll.every((re) => re.test(blob))) return false;
  if (cluster.matchAny?.length && !cluster.matchAny.some((re) => re.test(blob))) return false;
  if (cluster.rejectIf?.some((re) => re.test(blob))) return false;
  return true;
}

function keyphraseIntents(concepts: string[], limit = 4): string[] {
  // Prefer longer / multi-word concepts as search queries
  return [...concepts]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .filter((c) => c.split(/\s+/).length >= 2 || c.length >= 10)
    .slice(0, limit);
}

/**
 * Plan multi-intent wiki navigation from MatterFrame concepts + story keyphrases.
 */
export function buildConceptRetrievalPlan(
  frame: MatterFrame,
  story = "",
): ConceptRetrievalPlan {
  const storyBlob = [
    story,
    ...frame.events.map((e) => e.description),
    ...frame.objectives,
    ...frame.concepts,
  ]
    .filter(Boolean)
    .join("\n");

  const keyphrases = extractStoryKeyphrases(storyBlob);
  const concepts = [
    ...new Set(
      [...frame.concepts.map((c) => c.trim().toLowerCase()).filter(Boolean), ...keyphrases],
    ),
  ].slice(0, 16);

  const blob = `${storyBlob}\n${concepts.join(" ")}`;
  const clusterIds: string[] = [];
  const intents = new Set<string>();
  const titleExclusions: RegExp[] = [];
  const suppress = new Set<string>();

  for (const cluster of CONCEPT_CLUSTERS) {
    if (!clusterMatches(cluster, blob)) continue;
    clusterIds.push(cluster.id);
    for (const intent of cluster.intents) intents.add(intent);
    if (cluster.titleExclusion) titleExclusions.push(cluster.titleExclusion);
    for (const s of cluster.suppressSlugDefaults || []) suppress.add(s);
  }

  // Always add a few keyphrase intents (MuISQA / LexKeyPlan) when clusters fired or story is rich
  for (const kp of keyphraseIntents(concepts, clusterIds.length ? 3 : 5)) {
    intents.add(kp);
  }

  // If no cluster matched, fall back to slug default intents via caller — still return keyphrases
  if (!clusterIds.length && !intents.size) {
    for (const slug of frame.primaryIssues.map((i) => i.slug)) {
      for (const intent of ISSUE_RETRIEVAL_INTENTS[slug] || []) intents.add(intent);
    }
  }

  return {
    concepts,
    intents: [...intents].slice(0, 10),
    titleExclusions,
    clusterIds,
    suppressSlugDefaults: [...suppress],
    source: "concept-plan",
  };
}

/** Whether default slug intents should be skipped for this story. */
export function shouldSuppressSlugDefaults(
  plan: ConceptRetrievalPlan,
  slug: string,
): boolean {
  return plan.suppressSlugDefaults.includes(slug);
}
