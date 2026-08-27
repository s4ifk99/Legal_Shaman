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
    id: "debt_iva_bankruptcy",
    matchAll: [
      /\b(iva|individual voluntary arrangement|bankruptcy|debt relief order|dro\b|breathing space|debt solution)\b/i,
    ],
    intents: [
      "IVA bankruptcy debt relief order",
      "breathing space debt solutions",
      "options if you cannot pay your debts",
    ],
    titleExclusion: /unfair dismissal|used car|visa|neighbour driveway/i,
    suppressSlugDefaults: ["employment", "consumer"],
  },
  {
    id: "council_tax_arrears",
    matchAll: [/\b(council tax)\b/i, /\b(arrears|bailiff|liability order|not paid|behind)\b/i],
    intents: [
      "council tax arrears bailiffs",
      "council tax liability order",
      "help with council tax debt",
    ],
    titleExclusion: /unfair dismissal|used car|visa refusal/i,
    suppressSlugDefaults: ["employment", "housing"],
  },
  {
    id: "benefits_pip_uc_appeal",
    matchAll: [
      /\b(universal credit|pip\b|personal independence|dla\b|esa\b|benefit|sanction)\b/i,
      /\b(appeal|tribunal|refused|stopped|sanction|assessment|mandatory reconsideration)\b/i,
    ],
    intents: [
      "universal credit appeal sanction",
      "PIP appeal tribunal mandatory reconsideration",
      "challenging a benefits decision",
    ],
    titleExclusion: /unfair dismissal|used car|neighbour driveway|visa refusal/i,
    suppressSlugDefaults: ["employment", "consumer", "housing"],
  },
  {
    id: "motoring_disqualification",
    matchAll: [
      /\b(speeding|penalty points|totting|exceptional hardship|driving (?:ban|disqualification)|disqualified)\b/i,
    ],
    rejectIf: [/\b(pcn|parking ticket|private car park|popla|drink.?driv|drug.?driv)\b/i],
    intents: [
      "driving ban disqualification motoring",
      "exceptional hardship penalty points",
      "speeding penalty points court",
    ],
    titleExclusion: /unfair dismissal|used car reject|neighbour driveway|visa/i,
    suppressSlugDefaults: ["employment", "consumer", "parking_pcn"],
  },
  {
    id: "drink_drug_driving",
    matchAll: [/\b(drink[-\s]?driv\w*|drunk\s+driv\w*|drug[-\s]?driv\w*|excess alcohol|fail(?:ed|ure) to provide)\b/i],
    intents: [
      "drink driving offence penalties",
      "drug driving charge court",
      "failing to provide specimen",
    ],
    titleExclusion: /parking ticket|POPLA|unfair dismissal|used car/i,
    suppressSlugDefaults: ["employment", "parking_pcn", "consumer"],
  },

  // —— Housing extras ——
  {
    id: "housing_homelessness",
    matchAll: [
      /\b(homeless|sofa.?surf|nowhere to (?:stay|live)|rough sleep|temporary accommodation|homelessness application)\b/i,
    ],
    intents: [
      "homelessness help local authority",
      "temporary accommodation homeless application",
      "priority need homelessness",
    ],
    titleExclusion: /used car|unfair dismissal|parking ticket|visa/i,
    suppressSlugDefaults: ["neighbour_dispute", "consumer", "employment"],
  },
  {
    id: "housing_joint_tenancy",
    matchAll: [/\b(joint tenancy|joint tenant|shared tenancy|housemate|flatmate)\b/i],
    matchAny: [/\b(rent|deposit|leave|liable|notice|landlord)\b/i],
    intents: [
      "joint tenancy liability leaving",
      "share accommodation joint tenancy",
      "ending a joint tenancy",
    ],
    titleExclusion: /used car|unfair dismissal|neighbour driveway/i,
    suppressSlugDefaults: ["neighbour_dispute", "employment"],
  },
  {
    id: "mortgage_possession",
    matchAll: [
      /\b(mortgage)\b/i,
      /\b(repossess|possession|arrears|lender|shortfall|cannot pay)\b/i,
    ],
    intents: [
      "mortgage possession repossession",
      "mortgage arrears help",
      "defend mortgage possession claim",
    ],
    titleExclusion: /used car|unfair dismissal|visa|neighbour driveway/i,
    suppressSlugDefaults: ["employment", "consumer", "neighbour_dispute"],
  },
  {
    id: "housing_council_social",
    matchAll: [
      /\b(council (?:tenant|flat|house)|housing association|social housing|secure tenancy|introductory tenancy)\b/i,
    ],
    matchAny: [/\b(evict|repair|mould|rent|transfer|succession|antisocial)\b/i],
    intents: [
      "council housing association tenant rights",
      "social housing eviction repairs",
      "housing association complaints",
    ],
    titleExclusion: /used car|unfair dismissal|private parking/i,
    suppressSlugDefaults: ["neighbour_dispute", "employment", "consumer"],
  },
  {
    id: "neighbour_noise_asb",
    matchAll: [
      /\b(neighbour|neighbor)\b/i,
      /\b(noise|noisy|antisocial|asb\b|barking|parties|music|nuisance)\b/i,
    ],
    rejectIf: [/\b(driveway|carport|boundary|right of way|parking on)\b/i],
    intents: [
      "neighbour noise nuisance complaint",
      "antisocial behaviour neighbour",
      "problems with neighbours noise",
    ],
    titleExclusion: /used car|section\s*21|unfair dismissal|parking ticket POPLA/i,
    suppressSlugDefaults: ["housing", "consumer", "employment"],
  },

  // —— Family extras ——
  {
    id: "family_domestic_abuse",
    matchAll: [
      /\b(domestic (?:abuse|violence)|non-?molestation|occupation order|coercive control|fleeing|refuge)\b/i,
    ],
    intents: [
      "domestic abuse protective order",
      "non-molestation occupation order",
      "getting help domestic abuse",
    ],
    titleExclusion: /used car|unfair dismissal|parking ticket|small claim belongings/i,
    suppressSlugDefaults: ["employment", "consumer", "consumer_small_claims"],
  },
  {
    id: "family_care_proceedings",
    matchAll: [
      /\b(care (?:order|proceedings)|social services|child protection|interim care|placement order)\b/i,
    ],
    intents: [
      "care proceedings social services",
      "care order child protection",
      "what happens in care proceedings",
    ],
    titleExclusion: /small claim|used car|unfair dismissal|visa refusal/i,
    suppressSlugDefaults: ["consumer_small_claims", "employment", "consumer"],
  },

  // —— Wills / planning ——
  {
    id: "wills_making",
    matchAll: [/\b(make a will|making a will|writing a will|will kit|testament)\b/i],
    rejectIf: [/\b(contest|challeng|disinherit|inheritance dispute|probate already)\b/i],
    intents: [
      "making a will England",
      "how to make a will Age UK",
      "will writing requirements",
    ],
    titleExclusion: /unfair dismissal|used car|visa|section\s*21/i,
    suppressSlugDefaults: ["employment", "consumer", "housing"],
  },
  {
    id: "probate_estate_admin",
    matchAll: [/\b(probate|executor|letters of administration|administer (?:the )?estate|grant of probate)\b/i],
    rejectIf: [/\b(contest|challeng|disinherit|inheritance dispute|left me out)\b/i],
    intents: [
      "applying for probate estate administration",
      "executor responsibilities probate",
      "letters of administration",
    ],
    titleExclusion: /unfair dismissal|used car|neighbour driveway/i,
    suppressSlugDefaults: ["employment", "consumer", "housing"],
  },
  {
    id: "inheritance_dispute",
    matchAll: [
      /\b(inherit|inheritance|will)\b/i,
      /\b(contest|challeng|dispute|disinherit|left out|1975 act|family provision)\b/i,
    ],
    intents: [
      "contesting a will inheritance dispute",
      "Inheritance Act 1975 family provision",
      "challenging a will",
    ],
    titleExclusion: /unfair dismissal|used car|parking ticket/i,
    suppressSlugDefaults: ["employment", "consumer"],
  },
  {
    id: "lasting_power_attorney",
    matchAll: [/\b(lasting power of attorney|lpa\b|power of attorney|deputy order|court of protection)\b/i],
    intents: [
      "lasting power of attorney LPA",
      "setting up a lasting power of attorney",
      "Court of Protection deputy",
    ],
    titleExclusion: /unfair dismissal|used car|visa|section\s*21/i,
    suppressSlugDefaults: ["employment", "consumer", "housing"],
  },
  {
    id: "trusts_ctf",
    matchAll: [/\b(trust\b|trustee|child trust fund|ctf\b|beneficial interest)\b/i],
    matchAny: [/\b(will|estate|settlement|beneficiary|trust fund)\b/i],
    rejectIf: [/\b(unfair dismiss|used car|parking ticket)\b/i],
    intents: [
      "trusts trustees beneficiaries",
      "child trust fund",
      "trusts and inheritance",
    ],
    titleExclusion: /unfair dismissal|used car|parking ticket/i,
    suppressSlugDefaults: ["employment", "consumer"],
  },

  // —— Immigration extras ——
  {
    id: "asylum_refugees",
    matchAll: [/\b(asylum|refugee|asylum seeker|protection claim|NASS|asylum support)\b/i],
    intents: [
      "asylum claim UK refugee",
      "asylum support housing",
      "challenging an asylum decision",
    ],
    titleExclusion: /unfair dismissal|used car|neighbour driveway|section\s*21 tenancy/i,
    suppressSlugDefaults: ["employment", "consumer", "housing"],
  },
  {
    id: "british_citizenship",
    matchAll: [
      /\b(british citizenship|naturalis|citizenship application|british passport|register as british)\b/i,
    ],
    intents: [
      "British citizenship application naturalisation",
      "register as a British citizen",
      "citizenship requirements GOV.UK",
    ],
    titleExclusion: /unfair dismissal|used car|section\s*21/i,
    suppressSlugDefaults: ["employment", "consumer", "housing"],
  },

  // —— Consumer extras ——
  {
    id: "consumer_travel_holidays",
    matchAll: [
      /\b(holiday|flight|airline|package holiday|tour|travel agent|cruise|hotel booking|ATOL)\b/i,
      /\b(cancel|refund|delay|disrupted|mis-?sold|complaint|compensation)\b/i,
    ],
    intents: [
      "holiday flight delay compensation refund",
      "package holiday ATOL protection",
      "travel agent complaint consumer",
    ],
    titleExclusion: /unfair dismissal|neighbour driveway|section\s*21|visa refusal/i,
    suppressSlugDefaults: ["employment", "housing"],
  },
  {
    id: "consumer_online_distance",
    matchAll: [
      /\b(bought online|distance selling|cooling.?off|amazon|ebay|marketplace|click and collect)\b/i,
      /\b(cancel|refund|return|not arrived|wrong item|consumer contracts)\b/i,
    ],
    rejectIf: [/\b(used car|garage|landlord|employer|visa)\b/i],
    intents: [
      "cancelling online purchase cooling off",
      "distance selling consumer contracts",
      "marketplace seller refund rights",
    ],
    titleExclusion: /unfair dismissal|section\s*21|visa|neighbour driveway/i,
    suppressSlugDefaults: ["employment", "housing"],
  },
  {
    id: "consumer_credit_finance",
    matchAll: [
      /\b(credit card|personal loan|finance agreement|hire purchase|logbook loan|payday|APR)\b/i,
      /\b(unfair|mis-?sold|section\s*75|chargeback|affordability|FCA|ombudsman)\b/i,
    ],
    intents: [
      "section 75 credit card claim",
      "unfair credit agreement complaint",
      "Financial Ombudsman consumer credit",
    ],
    titleExclusion: /unfair dismissal|neighbour driveway|visa|section\s*21 housing/i,
    suppressSlugDefaults: ["employment", "housing"],
  },
  {
    id: "consumer_insurance_claim",
    matchAll: [
      /\b(insurance|insurer|policy)\b/i,
      /\b(claim|refused|rejected|won'?t pay|payout|excess|mis-?sold PPI)\b/i,
    ],
    rejectIf: [/\b(visa|section\s*21|unfair dismiss|bradford)\b/i],
    intents: [
      "insurance claim refused complaint",
      "Financial Ombudsman insurance",
      "challenging an insurance decision",
    ],
    titleExclusion: /unfair dismissal|neighbour driveway|section\s*21/i,
    suppressSlugDefaults: ["employment", "housing"],
  },
  {
    id: "consumer_energy_telecoms",
    matchAll: [
      /\b(energy|gas|electricity|broadband|mobile phone|ofcom|ofgem|supplier)\b/i,
      /\b(bill|overcharge|switch|complaint|ombudsman|debt|disconnection)\b/i,
    ],
    intents: [
      "energy bill complaint ombudsman",
      "broadband mobile Ofcom complaint",
      "gas electricity supplier dispute",
    ],
    titleExclusion: /unfair dismissal|used car|visa|neighbour driveway/i,
    suppressSlugDefaults: ["employment", "housing"],
  },
  {
    id: "employment_settlement_agreement",
    matchAll: [/\b(settlement agreement|compromise agreement|COT3|without prejudice)\b/i],
    intents: [
      "settlement agreement employment",
      "signing a settlement agreement ACAS",
      "COT3 conciliation settlement",
    ],
    titleExclusion: /used car|parking ticket|visa|neighbour driveway/i,
    suppressSlugDefaults: ["consumer", "housing"],
  },

  // —— Health / injury ——
  {
    id: "personal_injury_claim",
    matchAll: [
      /\b(personal injury|accident at work|slipped|whiplash|injured|road traffic accident|\brta\b)\b/i,
      /\b(claim|compensation|negligen|fault|injury)\b/i,
    ],
    rejectIf: [/\b(clinical|medical negligence|nhs complain|hospital misdiagnos)\b/i],
    intents: [
      "personal injury claim compensation",
      "accident at work injury claim",
      "road traffic accident injury claim",
    ],
    titleExclusion: /unfair dismissal schedule of loss|used car reject|visa|section\s*21/i,
    suppressSlugDefaults: ["employment", "consumer", "housing"],
  },
  {
    id: "clinical_negligence",
    matchAll: [
      /\b(clinical negligence|medical negligence|misdiagnos|surgical error|nhs (?:negligen|complaint)|AvMA)\b/i,
    ],
    intents: [
      "clinical negligence claim NHS",
      "medical negligence compensation",
      "complaining about NHS treatment AvMA",
    ],
    titleExclusion: /unfair dismissal|used car|neighbour driveway|visa/i,
    suppressSlugDefaults: ["employment", "consumer", "housing"],
  },

  // —— Crime / police ——
  {
    id: "police_station_arrest",
    matchAll: [
      /\b(arrest(?:ed)?|police station|under caution|charged with|custody|duty solicitor)\b/i,
    ],
    rejectIf: [/\b(parking ticket|pcn|popLA|civil claim only)\b/i],
    intents: [
      "arrested police station rights",
      "duty solicitor custody",
      "what happens if you are charged",
    ],
    titleExclusion: /unfair dismissal|used car|section\s*21|visa apply/i,
    suppressSlugDefaults: ["employment", "consumer", "housing"],
  },
  {
    id: "police_property_seizure",
    matchAll: [
      /\b(police)\b/i,
      /\b(seiz(?:ed|ure)|retained (?:my )?property|kept my (?:phone|laptop|car)|return (?:my )?property)\b/i,
    ],
    intents: [
      "police seized property return",
      "getting property back from police",
      "police retention of belongings",
    ],
    titleExclusion: /unfair dismissal|used car reject|section\s*21/i,
    suppressSlugDefaults: ["employment", "consumer", "housing"],
  },
  {
    id: "fraud_financial_crime_victim",
    matchAll: [
      /\b(fraud|scam|phishing|authorised push payment|APP fraud|identity theft)\b/i,
      /\b(victim|stolen|bank|money|report|refund)\b/i,
    ],
    intents: [
      "fraud scam victim bank refund",
      "authorised push payment APP fraud",
      "reporting fraud Action Fraud",
    ],
    titleExclusion: /unfair dismissal|neighbour driveway|section\s*21/i,
    suppressSlugDefaults: ["employment", "housing"],
  },

  // —— Rights / public law / education / courts / care ——
  {
    id: "equality_goods_services",
    matchAll: [
      /\b(equality act|discriminat|protected characteristic)\b/i,
      /\b(shop|restaurant|hotel|gym|service provider|goods and services|refused (?:entry|service)|wheelchair|accessibility)\b/i,
    ],
    rejectIf: [/\b(employer|at work|bradford|dismissed|sacked)\b/i],
    intents: [
      "discrimination in goods and services Equality Act",
      "taking action about discrimination goods services",
      "protected characteristics service provider",
    ],
    titleExclusion: /unfair dismissal|schedule of loss|used car|section\s*21/i,
    suppressSlugDefaults: ["employment", "housing"],
  },
  {
    id: "judicial_review_challenge",
    matchAll: [/\b(judicial review|JR claim)\b/i],
    matchAny: [
      /\b(public body|local authority|council decision|quash|challenge|pre-action|letter before claim|ultra vires)\b/i,
    ],
    intents: [
      "judicial review public body decision",
      "challenging a local authority decision",
      "judicial review pre-action protocol",
    ],
    titleExclusion: /unfair dismissal|used car|parking POPLA/i,
    suppressSlugDefaults: ["employment", "consumer"],
  },
  {
    id: "education_exclusion_ehcp",
    matchAll: [
      /\b(school|ehcp|sen\b|send\b|exclusion|excluded|special educational|admission appeal)\b/i,
      /\b(appeal|tribunal|ehcp|exclusion|sen|send|education)\b/i,
    ],
    intents: [
      "school exclusion appeal EHCP",
      "special educational needs EHCP",
      "school admission appeal",
    ],
    titleExclusion: /unfair dismissal|used car|neighbour driveway|visa/i,
    suppressSlugDefaults: ["employment", "consumer", "housing"],
  },
  {
    id: "small_claims_procedure",
    matchAll: [
      /\b(small claim|money claim|N1\b|county court claim|letter before action|claim form)\b/i,
    ],
    rejectIf: [/\b(child arrangements|custody|visa refusal|unfair dismiss)\b/i],
    intents: [
      "deciding whether to make a small claim",
      "letter before action money claim",
      "small claims court and letter before action",
    ],
    titleExclusion: /child arrangements|custody|visa refusal|unfair dismissal claim/i,
    suppressSlugDefaults: ["family", "employment"],
  },
  {
    id: "litigant_in_person_hearing",
    matchAll: [
      /\b(litigant in person|representing myself|court hearing|case management|bundle)\b/i,
    ],
    intents: [
      "litigant in person court hearing",
      "representing yourself in court",
      "preparing for a court hearing",
    ],
    titleExclusion: /used car Motor Ombudsman|bradford factor/i,
    suppressSlugDefaults: ["employment", "consumer"],
  },
  {
    id: "community_care_assessment",
    matchAll: [
      /\b(care assessment|social care|care package|care needs|local authority care|carer'?s assessment)\b/i,
    ],
    intents: [
      "adult social care assessment",
      "care needs assessment local authority",
      "challenging a care package decision",
    ],
    titleExclusion: /unfair dismissal|used car|parking ticket/i,
    suppressSlugDefaults: ["employment", "consumer"],
  },
  {
    id: "mental_health_detention",
    matchAll: [
      /\b(sectioned|mental health act|detention|nearest relative|tribunal mental|MHA\b)\b/i,
    ],
    intents: [
      "Mental Health Act detention rights",
      "sectioned nearest relative",
      "mental health tribunal",
    ],
    titleExclusion: /unfair dismissal|used car|section\s*21 tenancy/i,
    suppressSlugDefaults: ["employment", "consumer", "housing"],
  },

  // —— Business (thin) ——
  {
    id: "business_contract_dispute",
    matchAll: [
      /\b(limited company|ltd\b|sole trader|partnership|b2b|business contract|supplier agreement)\b/i,
      /\b(breach|dispute|invoice unpaid|contract|terms)\b/i,
    ],
    rejectIf: [/\b(my employer sacked|unfair dismiss|tenant landlord)\b/i],
    intents: [
      "business contract dispute",
      "unpaid business invoice",
      "breach of contract company",
    ],
    titleExclusion: /unfair dismissal employee|section\s*21|neighbour driveway/i,
    suppressSlugDefaults: ["employment", "housing"],
  },
  {
    id: "business_insolvency_closure",
    matchAll: [
      /\b(liquidat|insolvent|administration|strike off|close (?:my |the )?company|creditors.? voluntary)\b/i,
    ],
    intents: [
      "company insolvency liquidation",
      "closing a limited company",
      "company administration creditors",
    ],
    titleExclusion: /unfair dismissal|used car|neighbour driveway/i,
    suppressSlugDefaults: ["employment", "consumer", "housing"],
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
  // Prefer longer / multi-word concepts as search queries (agent concepts + LexKeyPlan)
  return [...concepts]
    .map((c) => c.trim())
    .filter((c) => c.length >= 4)
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

  // Always add keyphrase / agent-concept intents (MuISQA / LexKeyPlan)
  for (const kp of keyphraseIntents(concepts, clusterIds.length ? 4 : 6)) {
    intents.add(kp);
  }

  // If no cluster matched, still keep concept intents; slug defaults fill via buildRetrievalPlan
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
