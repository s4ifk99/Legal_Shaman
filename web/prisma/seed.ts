/**
 * Seed script for Legal Shaman MVP.
 *
 * Run: `cd web && npm run db:seed` (after `db:migrate:dev`).
 *
 * Creates 24 sample lawyers across 6 practice areas with realistic UK names,
 * cities, languages, credentials, and reviews. If `LLM_API_KEY` is set, also
 * generates embeddings via the OpenAI-compatible client so semantic search
 * works out of the box. If not, lawyers are inserted without embeddings and
 * you can backfill via `POST /api/lawyers/embed` later.
 */

import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

const prisma = new PrismaClient();

type PracticeSlug =
  | "employment"
  | "immigration"
  | "family"
  | "criminal_defence"
  | "personal_injury"
  | "commercial";

type SeedLawyer = {
  name: string;
  firmName: string;
  bio: string;
  practiceAreas: PracticeSlug[];
  city: string;
  postcode: string;
  jurisdiction: string;
  languages: string[];
  yearsExperience: number;
  rating: number;
  reviewCount: number;
  consultationOptions: string[];
  verifiedCredentials: boolean;
  credential: { authority: string; registrationNumber: string };
  availability: {
    acceptingClients: boolean;
    responseHours: number;
    freeConsultation: boolean;
    fixedFeeConsultation: boolean;
  };
  reviews?: { rating: number; body: string }[];
};

const PRACTICE_AREAS: { slug: PracticeSlug; name: string }[] = [
  { slug: "employment", name: "Employment Law" },
  { slug: "immigration", name: "Immigration Law" },
  { slug: "family", name: "Family Law" },
  { slug: "criminal_defence", name: "Criminal Defence" },
  { slug: "personal_injury", name: "Personal Injury" },
  { slug: "commercial", name: "Commercial Law" },
];

const LANGUAGES: { code: string; name: string }[] = [
  { code: "en", name: "English" },
  { code: "ur", name: "Urdu" },
  { code: "pa", name: "Punjabi" },
  { code: "ar", name: "Arabic" },
  { code: "zh", name: "Mandarin" },
  { code: "pl", name: "Polish" },
  { code: "ro", name: "Romanian" },
  { code: "fr", name: "French" },
  { code: "es", name: "Spanish" },
  { code: "bn", name: "Bengali" },
];

const LAWYERS: SeedLawyer[] = [
  // ---- Employment (4) ----
  {
    name: "Sarah Whitmore",
    firmName: "Whitmore Employment Solicitors",
    bio: "Specialist in unfair dismissal, redundancy disputes, and discrimination claims under the Equality Act 2010. Regularly represents claimants in the London Central Employment Tribunal.",
    practiceAreas: ["employment"],
    city: "London",
    postcode: "EC1A 4HD",
    jurisdiction: "England & Wales",
    languages: ["English"],
    yearsExperience: 14,
    rating: 4.8,
    reviewCount: 42,
    consultationOptions: ["phone", "video", "in_person", "fixed_fee"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "543921" },
    availability: {
      acceptingClients: true,
      responseHours: 24,
      freeConsultation: false,
      fixedFeeConsultation: true,
    },
    reviews: [
      { rating: 5, body: "Clear advice on my redundancy claim — settled out of court." },
      { rating: 5, body: "Patient and thorough. Explained tribunal procedure step by step." },
    ],
  },
  {
    name: "Ahmed Khan",
    firmName: "Northway Employment Law",
    bio: "Workplace discrimination, whistleblowing, and constructive dismissal cases. Native Urdu speaker, regularly advises South Asian community organisations in Greater Manchester.",
    practiceAreas: ["employment"],
    city: "Manchester",
    postcode: "M1 4ET",
    jurisdiction: "England & Wales",
    languages: ["English", "Urdu", "Punjabi"],
    yearsExperience: 11,
    rating: 4.7,
    reviewCount: 31,
    consultationOptions: ["phone", "video", "free_consultation"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "612340" },
    availability: {
      acceptingClients: true,
      responseHours: 36,
      freeConsultation: true,
      fixedFeeConsultation: false,
    },
    reviews: [{ rating: 5, body: "Took my whistleblowing case seriously when no one else would." }],
  },
  {
    name: "Olivia Reece",
    firmName: "Reece & Partners",
    bio: "Acts for senior employees and executives in exit negotiations, restrictive covenants, and bonus disputes in the financial services sector.",
    practiceAreas: ["employment", "commercial"],
    city: "Leeds",
    postcode: "LS1 2HD",
    jurisdiction: "England & Wales",
    languages: ["English", "French"],
    yearsExperience: 18,
    rating: 4.6,
    reviewCount: 27,
    consultationOptions: ["phone", "video", "fixed_fee"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "428117" },
    availability: {
      acceptingClients: true,
      responseHours: 48,
      freeConsultation: false,
      fixedFeeConsultation: true,
    },
  },
  {
    name: "James O'Connor",
    firmName: "Midland Workers' Rights",
    bio: "Trade-union-instructed solicitor focused on collective redundancy, TUPE transfers, and unauthorised deductions from wages.",
    practiceAreas: ["employment"],
    city: "Birmingham",
    postcode: "B2 5DP",
    jurisdiction: "England & Wales",
    languages: ["English"],
    yearsExperience: 9,
    rating: 4.5,
    reviewCount: 22,
    consultationOptions: ["phone", "in_person", "free_consultation"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "705882" },
    availability: {
      acceptingClients: true,
      responseHours: 24,
      freeConsultation: true,
      fixedFeeConsultation: false,
    },
  },

  // ---- Immigration (4) ----
  {
    name: "Farah Mahmood",
    firmName: "Crescent Immigration Law",
    bio: "Spouse and family visa applications, indefinite leave to remain, and appeals to the First-tier Tribunal (Immigration & Asylum). Fluent in Urdu and Punjabi.",
    practiceAreas: ["immigration"],
    city: "London",
    postcode: "E1 6AN",
    jurisdiction: "England & Wales",
    languages: ["English", "Urdu", "Punjabi"],
    yearsExperience: 12,
    rating: 4.9,
    reviewCount: 58,
    consultationOptions: ["phone", "video", "in_person", "fixed_fee"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "551203" },
    availability: {
      acceptingClients: true,
      responseHours: 24,
      freeConsultation: false,
      fixedFeeConsultation: true,
    },
    reviews: [
      { rating: 5, body: "Guided my mother through her ILR application with care and patience." },
    ],
  },
  {
    name: "Hassan Al-Rashid",
    firmName: "Al-Rashid & Co Immigration",
    bio: "Asylum and humanitarian protection claims, with particular experience representing Arabic-speaking clients from Syria, Iraq, and Sudan.",
    practiceAreas: ["immigration"],
    city: "Birmingham",
    postcode: "B5 6DR",
    jurisdiction: "England & Wales",
    languages: ["English", "Arabic"],
    yearsExperience: 16,
    rating: 4.8,
    reviewCount: 71,
    consultationOptions: ["phone", "video", "in_person", "free_consultation"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "402991" },
    availability: {
      acceptingClients: true,
      responseHours: 24,
      freeConsultation: true,
      fixedFeeConsultation: false,
    },
  },
  {
    name: "Wei Chen",
    firmName: "Chen Global Mobility",
    bio: "Skilled Worker, Innovator Founder, and Global Talent visa specialist. Advises Chinese tech founders and corporate sponsors. Mandarin speaker.",
    practiceAreas: ["immigration", "commercial"],
    city: "London",
    postcode: "EC2M 7AA",
    jurisdiction: "England & Wales",
    languages: ["English", "Mandarin"],
    yearsExperience: 10,
    rating: 4.7,
    reviewCount: 39,
    consultationOptions: ["phone", "video", "fixed_fee"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "618223" },
    availability: {
      acceptingClients: true,
      responseHours: 12,
      freeConsultation: false,
      fixedFeeConsultation: true,
    },
  },
  {
    name: "Anna Kowalski",
    firmName: "Northern Immigration Advice",
    bio: "EU Settled Status, settlement applications, and family reunion cases. Polish, Romanian, and English; works with community advice centres across the North West.",
    practiceAreas: ["immigration"],
    city: "Manchester",
    postcode: "M3 3HE",
    jurisdiction: "England & Wales",
    languages: ["English", "Polish", "Romanian"],
    yearsExperience: 8,
    rating: 4.6,
    reviewCount: 24,
    consultationOptions: ["phone", "video", "free_consultation"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "732845" },
    availability: {
      acceptingClients: true,
      responseHours: 48,
      freeConsultation: true,
      fixedFeeConsultation: false,
    },
  },

  // ---- Family (4) ----
  {
    name: "Eleanor Pritchard",
    firmName: "Pritchard Family Law",
    bio: "Divorce, financial settlements, and child arrangements. Member of Resolution; trained collaborative-law practitioner.",
    practiceAreas: ["family"],
    city: "Manchester",
    postcode: "M2 7LP",
    jurisdiction: "England & Wales",
    languages: ["English"],
    yearsExperience: 17,
    rating: 4.9,
    reviewCount: 48,
    consultationOptions: ["phone", "video", "in_person", "fixed_fee"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "381472" },
    availability: {
      acceptingClients: true,
      responseHours: 36,
      freeConsultation: false,
      fixedFeeConsultation: true,
    },
    reviews: [
      { rating: 5, body: "Settled my divorce amicably — appreciated the fixed-fee transparency." },
    ],
  },
  {
    name: "Daniel Hughes",
    firmName: "Hughes & Sons Family Solicitors",
    bio: "High-net-worth divorce, prenuptial agreements, and international child relocation. Works closely with forensic accountants.",
    practiceAreas: ["family"],
    city: "London",
    postcode: "W1G 9PN",
    jurisdiction: "England & Wales",
    languages: ["English"],
    yearsExperience: 22,
    rating: 4.7,
    reviewCount: 36,
    consultationOptions: ["phone", "video", "in_person"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "289004" },
    availability: {
      acceptingClients: true,
      responseHours: 48,
      freeConsultation: false,
      fixedFeeConsultation: false,
    },
  },
  {
    name: "Priya Sharma",
    firmName: "Bridge Family Law",
    bio: "Domestic abuse protection orders, financial remedies, and Hindu and Sikh religious divorce procedures. Bengali and Punjabi speaker.",
    practiceAreas: ["family"],
    city: "Leeds",
    postcode: "LS2 8JX",
    jurisdiction: "England & Wales",
    languages: ["English", "Bengali", "Punjabi"],
    yearsExperience: 13,
    rating: 4.8,
    reviewCount: 33,
    consultationOptions: ["phone", "video", "in_person", "free_consultation"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "476119" },
    availability: {
      acceptingClients: true,
      responseHours: 24,
      freeConsultation: true,
      fixedFeeConsultation: true,
    },
  },
  {
    name: "Catriona MacLeod",
    firmName: "MacLeod Family Solicitors",
    bio: "Scots family law specialist — separation agreements, child contact, and adoption applications in the Sheriff Courts.",
    practiceAreas: ["family"],
    city: "Edinburgh",
    postcode: "EH3 6JS",
    jurisdiction: "Scotland",
    languages: ["English"],
    yearsExperience: 15,
    rating: 4.6,
    reviewCount: 19,
    consultationOptions: ["phone", "video", "in_person", "fixed_fee"],
    verifiedCredentials: true,
    credential: { authority: "Law Society of Scotland", registrationNumber: "S-22841" },
    availability: {
      acceptingClients: true,
      responseHours: 36,
      freeConsultation: false,
      fixedFeeConsultation: true,
    },
  },

  // ---- Criminal Defence (4) ----
  {
    name: "Marcus Vance",
    firmName: "Vance Criminal Defence",
    bio: "24-hour police station representation, Crown Court trials, and serious motoring offences. Higher Rights of Audience.",
    practiceAreas: ["criminal_defence"],
    city: "London",
    postcode: "SE1 9NQ",
    jurisdiction: "England & Wales",
    languages: ["English"],
    yearsExperience: 19,
    rating: 4.7,
    reviewCount: 51,
    consultationOptions: ["phone", "in_person"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "344228" },
    availability: {
      acceptingClients: true,
      responseHours: 4,
      freeConsultation: true,
      fixedFeeConsultation: false,
    },
    reviews: [{ rating: 5, body: "Answered the phone at 2am when I was arrested. Saved me." }],
  },
  {
    name: "Rebecca Lin",
    firmName: "Lin Defence Solicitors",
    bio: "Fraud, money laundering, and POCA confiscation proceedings. Defends company directors and accountants under SFO investigation.",
    practiceAreas: ["criminal_defence", "commercial"],
    city: "London",
    postcode: "EC4Y 8DD",
    jurisdiction: "England & Wales",
    languages: ["English", "Mandarin"],
    yearsExperience: 13,
    rating: 4.8,
    reviewCount: 28,
    consultationOptions: ["phone", "video", "in_person", "fixed_fee"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "498205" },
    availability: {
      acceptingClients: true,
      responseHours: 12,
      freeConsultation: false,
      fixedFeeConsultation: true,
    },
  },
  {
    name: "Thomas Brennan",
    firmName: "Brennan Criminal Solicitors",
    bio: "Drug offences, drink driving, and youth court representation across the North of England. Duty solicitor.",
    practiceAreas: ["criminal_defence"],
    city: "Liverpool",
    postcode: "L2 4SP",
    jurisdiction: "England & Wales",
    languages: ["English"],
    yearsExperience: 21,
    rating: 4.5,
    reviewCount: 44,
    consultationOptions: ["phone", "in_person"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "201773" },
    availability: {
      acceptingClients: true,
      responseHours: 6,
      freeConsultation: true,
      fixedFeeConsultation: false,
    },
  },
  {
    name: "Aoife Murphy",
    firmName: "Murphy Defence",
    bio: "Belfast-based defence practitioner — Magistrates' and Crown Court advocacy, plus PSNI custody representation.",
    practiceAreas: ["criminal_defence"],
    city: "Belfast",
    postcode: "BT1 5GS",
    jurisdiction: "Northern Ireland",
    languages: ["English"],
    yearsExperience: 12,
    rating: 4.6,
    reviewCount: 18,
    consultationOptions: ["phone", "in_person"],
    verifiedCredentials: true,
    credential: { authority: "Law Society of Northern Ireland", registrationNumber: "NI-9182" },
    availability: {
      acceptingClients: true,
      responseHours: 4,
      freeConsultation: true,
      fixedFeeConsultation: false,
    },
  },

  // ---- Personal Injury (4) ----
  {
    name: "Michael Foster",
    firmName: "Foster Injury Lawyers",
    bio: "Road traffic accidents, workplace injury, and clinical negligence claims. No-win-no-fee agreements available.",
    practiceAreas: ["personal_injury"],
    city: "Birmingham",
    postcode: "B3 1DH",
    jurisdiction: "England & Wales",
    languages: ["English"],
    yearsExperience: 16,
    rating: 4.7,
    reviewCount: 62,
    consultationOptions: ["phone", "video", "free_consultation"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "367219" },
    availability: {
      acceptingClients: true,
      responseHours: 24,
      freeConsultation: true,
      fixedFeeConsultation: false,
    },
  },
  {
    name: "Jasmine Patel",
    firmName: "Patel Clinical Negligence",
    bio: "Birth-injury, misdiagnosis, and NHS complaints. Acts for families pursuing inquest representation.",
    practiceAreas: ["personal_injury"],
    city: "Leicester",
    postcode: "LE1 5JN",
    jurisdiction: "England & Wales",
    languages: ["English", "Bengali"],
    yearsExperience: 14,
    rating: 4.9,
    reviewCount: 37,
    consultationOptions: ["phone", "video", "in_person", "free_consultation"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "488203" },
    availability: {
      acceptingClients: true,
      responseHours: 24,
      freeConsultation: true,
      fixedFeeConsultation: false,
    },
    reviews: [
      { rating: 5, body: "Compassionate handling of a difficult misdiagnosis claim." },
    ],
  },
  {
    name: "Ryan Harper",
    firmName: "Harper Industrial Injury",
    bio: "Industrial disease, asbestos exposure, and HAVS claims. Long history with former miners and shipyard workers.",
    practiceAreas: ["personal_injury"],
    city: "Newcastle upon Tyne",
    postcode: "NE1 3DX",
    jurisdiction: "England & Wales",
    languages: ["English"],
    yearsExperience: 25,
    rating: 4.8,
    reviewCount: 41,
    consultationOptions: ["phone", "in_person", "free_consultation"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "159847" },
    availability: {
      acceptingClients: true,
      responseHours: 36,
      freeConsultation: true,
      fixedFeeConsultation: false,
    },
  },
  {
    name: "Sofia Ramirez",
    firmName: "Ramirez Road Injury",
    bio: "Cyclist and pedestrian RTA specialist. Spanish speaker. Works with EU residents pursuing UK claims.",
    practiceAreas: ["personal_injury"],
    city: "Bristol",
    postcode: "BS1 4DJ",
    jurisdiction: "England & Wales",
    languages: ["English", "Spanish"],
    yearsExperience: 9,
    rating: 4.6,
    reviewCount: 23,
    consultationOptions: ["phone", "video", "free_consultation"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "693017" },
    availability: {
      acceptingClients: true,
      responseHours: 24,
      freeConsultation: true,
      fixedFeeConsultation: false,
    },
  },

  // ---- Commercial (4) ----
  {
    name: "Henry Ashcroft",
    firmName: "Ashcroft Commercial",
    bio: "SME M&A, shareholder disputes, and commercial contracts. Acts for tech start-ups through Series B.",
    practiceAreas: ["commercial"],
    city: "London",
    postcode: "EC2A 4NE",
    jurisdiction: "England & Wales",
    languages: ["English"],
    yearsExperience: 20,
    rating: 4.7,
    reviewCount: 35,
    consultationOptions: ["phone", "video", "in_person", "fixed_fee"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "294118" },
    availability: {
      acceptingClients: true,
      responseHours: 24,
      freeConsultation: false,
      fixedFeeConsultation: true,
    },
  },
  {
    name: "Naomi Akinwale",
    firmName: "Akinwale Tech Law",
    bio: "SaaS contracts, data-processing agreements, and UK GDPR compliance. Advises e-commerce companies on consumer rights.",
    practiceAreas: ["commercial"],
    city: "London",
    postcode: "EC1V 9BD",
    jurisdiction: "England & Wales",
    languages: ["English", "French"],
    yearsExperience: 11,
    rating: 4.8,
    reviewCount: 29,
    consultationOptions: ["phone", "video", "fixed_fee"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "612998" },
    availability: {
      acceptingClients: true,
      responseHours: 36,
      freeConsultation: false,
      fixedFeeConsultation: true,
    },
  },
  {
    name: "Robert Sinclair",
    firmName: "Sinclair Commercial Solicitors",
    bio: "Commercial property, landlord & tenant disputes, and Scots commercial leases. Edinburgh-based with UK-wide practice.",
    practiceAreas: ["commercial"],
    city: "Edinburgh",
    postcode: "EH2 4LB",
    jurisdiction: "Scotland",
    languages: ["English"],
    yearsExperience: 23,
    rating: 4.6,
    reviewCount: 26,
    consultationOptions: ["phone", "video", "in_person"],
    verifiedCredentials: true,
    credential: { authority: "Law Society of Scotland", registrationNumber: "S-19033" },
    availability: {
      acceptingClients: true,
      responseHours: 48,
      freeConsultation: false,
      fixedFeeConsultation: false,
    },
  },
  {
    name: "Lucas Bianchi",
    firmName: "Bianchi & Wright",
    bio: "Cross-border supply contracts, distribution agreements, and international arbitration. Italian and Spanish speaker.",
    practiceAreas: ["commercial"],
    city: "London",
    postcode: "WC2E 7BB",
    jurisdiction: "England & Wales",
    languages: ["English", "Spanish"],
    yearsExperience: 17,
    rating: 4.7,
    reviewCount: 31,
    consultationOptions: ["phone", "video", "fixed_fee"],
    verifiedCredentials: true,
    credential: { authority: "SRA", registrationNumber: "517822" },
    availability: {
      acceptingClients: true,
      responseHours: 24,
      freeConsultation: false,
      fixedFeeConsultation: true,
    },
  },
];

async function main() {
  console.log(`[seed] inserting ${PRACTICE_AREAS.length} practice areas, ${LANGUAGES.length} languages, ${LAWYERS.length} lawyers`);

  // Upsert practice areas
  for (const pa of PRACTICE_AREAS) {
    await prisma.practiceArea.upsert({
      where: { slug: pa.slug },
      create: pa,
      update: { name: pa.name },
    });
  }

  // Upsert languages
  for (const lang of LANGUAGES) {
    await prisma.language.upsert({
      where: { code: lang.code },
      create: lang,
      update: { name: lang.name },
    });
  }

  // Build name -> id maps
  const paByName = new Map<PracticeSlug, string>();
  for (const pa of await prisma.practiceArea.findMany()) {
    paByName.set(pa.slug as PracticeSlug, pa.id);
  }
  const langByName = new Map<string, string>();
  for (const l of await prisma.language.findMany()) {
    langByName.set(l.name.toLowerCase(), l.id);
  }

  for (const s of LAWYERS) {
    // Upsert firm
    const firm = await prisma.firm.upsert({
      where: { id: `firm-${slugify(s.firmName)}` },
      create: {
        id: `firm-${slugify(s.firmName)}`,
        name: s.firmName,
        verified: true,
      },
      update: { name: s.firmName },
    });

    // Upsert lawyer (idempotent: deterministic id from name)
    const id = `lawyer-${slugify(s.name)}`;
    await prisma.lawyer.upsert({
      where: { id },
      create: {
        id,
        name: s.name,
        firmId: firm.id,
        bio: s.bio,
        yearsExperience: s.yearsExperience,
        rating: s.rating,
        reviewCount: s.reviewCount,
        consultationOptions: s.consultationOptions,
        verifiedCredentials: s.verifiedCredentials,
        profileUrl: null,
      },
      update: {
        firmId: firm.id,
        bio: s.bio,
        yearsExperience: s.yearsExperience,
        rating: s.rating,
        reviewCount: s.reviewCount,
        consultationOptions: s.consultationOptions,
        verifiedCredentials: s.verifiedCredentials,
      },
    });

    // Replace relations (delete + recreate is fine at this scale)
    await prisma.lawyerPracticeArea.deleteMany({ where: { lawyerId: id } });
    for (const slug of s.practiceAreas) {
      const paId = paByName.get(slug);
      if (!paId) continue;
      await prisma.lawyerPracticeArea.create({
        data: { lawyerId: id, practiceAreaId: paId },
      });
    }

    await prisma.location.deleteMany({ where: { lawyerId: id } });
    await prisma.location.create({
      data: {
        lawyerId: id,
        city: s.city,
        postcode: s.postcode,
        country: "United Kingdom",
        jurisdiction: s.jurisdiction,
      },
    });

    await prisma.lawyerLanguage.deleteMany({ where: { lawyerId: id } });
    for (const lname of s.languages) {
      const lid = langByName.get(lname.toLowerCase());
      if (!lid) continue;
      await prisma.lawyerLanguage.create({
        data: { lawyerId: id, languageId: lid },
      });
    }

    await prisma.credential.deleteMany({ where: { lawyerId: id } });
    await prisma.credential.create({
      data: {
        lawyerId: id,
        authority: s.credential.authority,
        registrationNumber: s.credential.registrationNumber,
        verifiedAt: new Date(),
      },
    });

    await prisma.availability.deleteMany({ where: { lawyerId: id } });
    await prisma.availability.create({
      data: { lawyerId: id, ...s.availability },
    });

    await prisma.review.deleteMany({ where: { lawyerId: id } });
    for (const r of s.reviews ?? []) {
      await prisma.review.create({
        data: { lawyerId: id, rating: r.rating, body: r.body, verified: true },
      });
    }
  }

  console.log("[seed] lawyer rows + relations done");

  if (process.env.LLM_API_KEY?.trim()) {
    console.log("[seed] LLM_API_KEY found, generating embeddings...");
    // Dynamic import avoids loading the OpenAI SDK when the key is absent.
    const { embedAllLawyers } = await import("../lib/lawyers/embed");
    const n = await embedAllLawyers();
    console.log(`[seed] embedded ${n} lawyers`);
  } else {
    console.log(
      "[seed] LLM_API_KEY not set — skipping embeddings. Backfill later with POST /api/lawyers/embed { all: true }.",
    );
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
