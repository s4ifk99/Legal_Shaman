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
  /** At least one must match. */
  matchAny?: RegExp[];
  intents: string[];
  titleExclusion?: RegExp;
  /** Coarse slugs whose hard-coded default intents would bleed (e.g. unfair dismissal). */
  suppressSlugDefaults?: string[];
};

/**
 * Concept clusters ≈ legal retrieval intents, not UI frames.
 * Prefer adding a cluster here over `looksX` + `emp-y` pairs.
 */
const CONCEPT_CLUSTERS: ConceptCluster[] = [
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
    id: "neighbour_access",
    matchAll: [
      /\b(neighbour|neighbor)\b/i,
      /\b(driveway|car\s*port|carport|park(?:ed|ing)|boundary|right of way|easement|blocking)\b/i,
    ],
    intents: [
      "neighbour dispute boundary planning",
      "right of way driveway access",
      "neighbour parking driveway dispute",
    ],
    titleExclusion: /used car|Consumer Rights Act|faulty goods|landlord repairs|section\s*21/i,
    suppressSlugDefaults: ["housing", "consumer", "consumer_vehicle_repair"],
  },
  {
    id: "used_car_reject",
    matchAll: [
      /\b(used car|bought .{0,20}car|dealer|trader)\b/i,
      /\b(reject|faulty|repair|refund|Consumer Rights|CRA)\b/i,
    ],
    intents: [
      "rejecting a faulty used car Consumer Rights Act",
      "buying a used car problem trader refund",
      "Motor Ombudsman faulty vehicle",
    ],
    titleExclusion: /neighbour|driveway|parking ticket|unfair dismissal/i,
    suppressSlugDefaults: ["employment", "housing"],
  },
  {
    id: "private_parking_pcn",
    matchAll: [/\b(pcn|parking (?:ticket|fine|charge)|popla|private (?:car\s*)?park)\b/i],
    intents: [
      "appealing a parking ticket",
      "penalty charge notice council PCN",
      "POPLA private parking appeal",
    ],
    titleExclusion: /employment|working time|unfair dismissal|used car bought/i,
    suppressSlugDefaults: ["employment"],
  },
];

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
    /\bemployment tribunal\b/gi,
    /\bconsumer rights act\b/gi,
    /\bsection\s*21\b/gi,
    /\bpenalty charge notice\b/gi,
    /\bright of way\b/gi,
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
