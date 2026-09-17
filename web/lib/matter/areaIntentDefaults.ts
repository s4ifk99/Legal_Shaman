/**
 * Wiki Area → taxonomy slug → default retrieval intents.
 *
 * Breadth of law = wiki Areas. Clusters are precision leaves; when no cluster
 * matches, these slug defaults navigate the Area. Keep in sync with
 * data/wiki-index.json categories / Areas/ top folders.
 */

export type WikiAreaIntentDefault = {
  /** Matches wiki `category` / `Areas/<name>/` */
  area: string;
  taxonomySlugs: string[];
  defaultIntents: string[];
  retrievalScopes: string[];
};

/** One row per Legal Shaman wiki Area (citizen-facing breadth). */
export const WIKI_AREA_INTENT_DEFAULTS: WikiAreaIntentDefault[] = [
  {
    area: "Home and Housing",
    taxonomySlugs: ["housing", "conveyancing"],
    defaultIntents: [
      "housing disrepair mould landlord repair",
      "section 21 notice tenant eviction",
      "tenancy deposit dispute",
      "homelessness help local authority",
      "buying and selling a home conveyancing",
    ],
    retrievalScopes: ["housing", "landlord_tenant", "property", "conveyancing"],
  },
  {
    area: "Neighbours and Property",
    taxonomySlugs: ["neighbour_dispute"],
    defaultIntents: [
      "neighbour dispute boundary planning",
      "right of way driveway access",
      "neighbour noise nuisance",
      "problems with neighbours Citizens Advice",
    ],
    retrievalScopes: ["property", "neighbours", "planning"],
  },
  {
    area: "Work and Employment",
    taxonomySlugs: ["employment"],
    defaultIntents: [
      "employment rights at work ACAS",
      "unfair dismissal employment tribunal ACAS",
      "discrimination at work Equality Act",
      "holiday pay wages working time",
    ],
    retrievalScopes: ["employment"],
  },
  {
    area: "Family and Relationships",
    taxonomySlugs: ["family"],
    defaultIntents: [
      "child arrangements contact order",
      "divorce finances family court",
      "domestic abuse protective order",
      "separation money and property",
    ],
    retrievalScopes: ["family"],
  },
  {
    area: "Wills and Planning Ahead",
    taxonomySlugs: ["wills_probate"],
    defaultIntents: [
      "making a will England",
      "applying for probate estate administration",
      "lasting power of attorney LPA",
      "contesting a will inheritance dispute",
    ],
    retrievalScopes: ["wills", "probate", "inheritance"],
  },
  {
    area: "Money, Benefits and Debt",
    taxonomySlugs: ["debt", "welfare_benefits"],
    defaultIntents: [
      "bailiff debt creditor rights",
      "IVA bankruptcy debt relief order",
      "universal credit PIP benefits appeal",
      "council tax arrears help",
    ],
    retrievalScopes: ["debt", "benefits", "welfare"],
  },
  {
    area: "Consumer Rights",
    taxonomySlugs: ["consumer", "consumer_services", "consumer_vehicle_repair", "consumer_small_claims"],
    defaultIntents: [
      "consumer rights faulty goods refund",
      "problems with services or traders",
      "problem with a car repair garage consumer",
      "small claims court letter before action",
      "holiday flight compensation consumer",
    ],
    retrievalScopes: ["consumer", "services", "vehicle_repair", "civil_claims"],
  },
  {
    area: "Immigration and Citizenship",
    taxonomySlugs: ["immigration"],
    defaultIntents: [
      "family visa partner spouse application",
      "visa refusal immigration appeal",
      "British citizenship naturalisation",
      "asylum claim refugee support",
    ],
    retrievalScopes: ["immigration"],
  },
  {
    area: "Rights and Discrimination",
    taxonomySlugs: ["discrimination_equality", "human_rights", "public_law"],
    defaultIntents: [
      "discrimination in goods and services Equality Act",
      "protected characteristics discrimination",
      "judicial review public body decision",
      "human rights public authority",
    ],
    retrievalScopes: ["equality", "discrimination", "public_law", "human_rights"],
  },
  {
    area: "Crime and Police",
    taxonomySlugs: ["criminal_defence", "prison_law", "fraud_financial_crime"],
    defaultIntents: [
      "arrested police station rights duty solicitor",
      "magistrates court charged with offence",
      "police seized property return",
      "fraud scam victim bank refund",
    ],
    retrievalScopes: ["crime", "police", "fraud"],
  },
  {
    area: "Health and Injury",
    taxonomySlugs: ["personal_injury", "clinical_negligence", "community_care", "mental_health"],
    defaultIntents: [
      "personal injury claim compensation",
      "clinical negligence NHS claim",
      "adult social care assessment",
      "Mental Health Act detention rights",
    ],
    retrievalScopes: ["injury", "health", "clinical_negligence", "social_care"],
  },
  {
    area: "Driving and Parking",
    taxonomySlugs: ["parking_pcn", "motoring_offences"],
    defaultIntents: [
      "appealing a parking ticket",
      "penalty charge notice council PCN",
      "driving ban disqualification motoring",
      "drink driving offence penalties",
    ],
    retrievalScopes: ["motoring", "parking", "administrative_appeals"],
  },
  {
    area: "Courts and Disputes",
    taxonomySlugs: ["consumer_small_claims", "public_law"],
    defaultIntents: [
      "deciding whether to make a small claim",
      "letter before action money claim",
      "litigant in person court hearing",
      "judicial review pre-action protocol",
    ],
    retrievalScopes: ["civil_claims", "courts", "public_law"],
  },
  {
    area: "Your Business",
    taxonomySlugs: ["commercial"],
    defaultIntents: [
      "business contract dispute unpaid invoice",
      "company insolvency liquidation",
      "starting a limited company legal",
      "sole trader contracts agreements",
    ],
    retrievalScopes: ["business", "commercial", "company"],
  },
  {
    area: "Getting Help",
    taxonomySlugs: ["legal_aid", "getting_help"],
    defaultIntents: [
      "finding free legal advice Citizens Advice",
      "legal aid eligibility",
      "Law Centres Network help",
    ],
    retrievalScopes: ["getting_help", "legal_aid"],
  },
];

/** Education appears in signposting + taxonomy; wiki Area folder may be thin. */
export const EDUCATION_AREA_DEFAULT: WikiAreaIntentDefault = {
  area: "Education",
  taxonomySlugs: ["education"],
  defaultIntents: [
    "school exclusion appeal EHCP",
    "special educational needs EHCP",
    "school admission appeal",
  ],
  retrievalScopes: ["education", "sen", "schools"],
};

const ALL_AREA_DEFAULTS = [...WIKI_AREA_INTENT_DEFAULTS, EDUCATION_AREA_DEFAULT];

/** Flatten Area defaults → slug → intents (first Area wins per slug; then append unique). */
export function buildSlugIntentDefaults(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const row of ALL_AREA_DEFAULTS) {
    for (const slug of row.taxonomySlugs) {
      const existing = out[slug] || [];
      const merged = [...existing];
      for (const intent of row.defaultIntents) {
        if (!merged.includes(intent)) merged.push(intent);
      }
      out[slug] = merged.slice(0, 6);
    }
  }
  return out;
}

export function buildSlugRetrievalScopes(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const row of ALL_AREA_DEFAULTS) {
    for (const slug of row.taxonomySlugs) {
      const existing = out[slug] || [];
      out[slug] = [...new Set([...existing, ...row.retrievalScopes, row.area])];
    }
  }
  return out;
}

export function areaForSlug(slug: string): string | null {
  for (const row of ALL_AREA_DEFAULTS) {
    if (row.taxonomySlugs.includes(slug)) return row.area;
  }
  return null;
}

export function listWikiAreas(): string[] {
  return ALL_AREA_DEFAULTS.map((r) => r.area);
}

export const SLUG_INTENT_DEFAULTS = buildSlugIntentDefaults();
export const SLUG_RETRIEVAL_SCOPES = buildSlugRetrievalScopes();
