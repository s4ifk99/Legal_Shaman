/**
 * Rebuild signposting-resources.json for consumer-oriented wiki areas.
 * Run: node scripts/build-signposting-resources.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(__dirname, "../data/signposting-resources.json");
const backupPath = path.join(__dirname, "../data/signposting-resources.pre-consumer.json");

const existing = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const byTitle = new Map(existing.sections.map((s) => [s.title, s.resources]));

function wikiResource(areaTitle, blurb) {
  const q = encodeURIComponent(areaTitle);
  return {
    name: `Legal Shaman wiki — ${areaTitle}`,
    description: blurb,
    url: `/ask-the-shaman?q=${q}`,
    links: [
      {
        text: "Search wiki guides",
        url: `/ask-the-shaman?q=${q}`,
      },
      {
        text: "Find a lawyer",
        url: "/find-a-lawyer",
      },
    ],
  };
}

const WILLS_RESOURCES = [
  wikiResource(
    "Wills and Planning Ahead",
    "Wills, probate, inheritance tax, and lasting powers of attorney — plain-language guides from approved sources.",
  ),
  {
    name: "Citizens Advice — making a will",
    url: "https://www.citizensadvice.org.uk/family/death-and-wills/making-a-will/",
    description: "Who needs a will, what to include, and how to get it signed correctly.",
  },
  {
    name: "GOV.UK — make a will",
    url: "https://www.gov.uk/make-will",
    description: "Official overview of making and updating a will in England and Wales.",
  },
  {
    name: "Age UK — making a will",
    url: "https://www.ageuk.org.uk/information-advice/money-legal/legal-issues/making-a-will/",
    description: "Practical guidance for older people planning a will.",
  },
  {
    name: "GOV.UK — lasting power of attorney",
    url: "https://www.gov.uk/power-of-attorney",
    description: "How to appoint someone to make decisions for you if you lose capacity.",
  },
];

const CONSUMER_RESOURCES = [
  wikiResource(
    "Consumer Rights",
    "Faulty goods, refunds, cancelled travel, and contracts with traders.",
  ),
  {
    name: "Citizens Advice — consumer service",
    url: "https://www.citizensadvice.org.uk/consumer/",
    description: "Buying, refunds, faulty goods, and problems with services.",
  },
  {
    name: "Which? Consumer Rights",
    url: "https://www.which.co.uk/consumer-rights",
    description: "Templates and guidance on returns, guarantees, and trader disputes.",
  },
  {
    name: "Resolver",
    url: "https://www.resolver.co.uk/",
    description: "Free tool to escalate complaints with many retailers and service providers.",
  },
];

const NEIGHBOURS_RESOURCES = [
  wikiResource(
    "Neighbours and Property",
    "Boundaries, noise, party walls, and disputes with neighbours.",
  ),
  {
    name: "GOV.UK — resolving neighbour disputes",
    url: "https://www.gov.uk/how-to-resolve-neighbour-disputes",
    description: "Mediation, noise, boundaries, and when to involve the council.",
  },
  {
    name: "RICS — party wall matters",
    url: "https://www.ricsfirms.com/home/party-wall/",
    description: "Find surveyors for party wall agreements and boundary issues.",
  },
];

const HEALTH_RESOURCES = [
  wikiResource(
    "Health and Injury",
    "Personal injury claims and clinical negligence — what to check before you claim.",
  ),
  {
    name: "Action against Medical Accidents (AvMA)",
    phone: "0845 123 2352",
    url: "https://www.avma.org.uk/",
    description: "Independent charity helping people affected by medical accidents.",
  },
  {
    name: "Citizens Advice — personal injury",
    url: "https://www.citizensadvice.org.uk/law-and-courts/personal-injuries/",
    description: "Overview of making a personal injury claim.",
  },
];

const BUSINESS_RESOURCES = [
  wikiResource(
    "Your Business",
    "Contracts, company structure, shareholders, and insolvency for small businesses.",
  ),
  {
    name: "LawWorks Not for Profit programme",
    description:
      "Brokers legal advice to small not-for-profit organisations on a wide range of legal issues.",
    url: "https://www.lawworks.org.uk/legal-advice-not-profits",
  },
  {
    name: "Federation of Small Businesses (FSB)",
    url: "https://www.fsb.org.uk/",
    description: "Membership body with legal protection and business advice for small firms.",
  },
  {
    name: "GOV.UK — set up a business",
    url: "https://www.gov.uk/set-up-business",
    description: "Official steps for sole traders, partnerships, and limited companies.",
  },
];

const sections = [
  {
    title: "Getting Help",
    resources: [
      wikiResource(
        "Getting Help",
        "Legal aid, pro bono routes, and national advice organisations.",
      ),
      ...byTitle
        .get("General advice")
        .filter(
          (r) =>
            r.name !== "LawWorks Not for Profit programme" &&
            r.name !== "Support Through Court" &&
            r.name !== "UK Deed Poll Office",
        ),
      ...byTitle.get("Legal aid eligibility & support"),
      ...byTitle.get("National legal advice organisations"),
    ],
  },
  {
    title: "Courts and Disputes",
    resources: [
      wikiResource(
        "Courts and Disputes",
        "Starting a claim, preparing documents, hearings, and enforcement — in plain language.",
      ),
      ...byTitle.get("Preparing documents and going to court"),
      ...byTitle.get("Remote hearings"),
      {
        name: "Support Through Court",
        description:
          "Supports people going through court proceedings without legal representation (non-legal advice).",
        url: "https://www.supportthroughcourt.org/",
      },
      {
        name: "Litigation funding options",
        description:
          "Third-party funding for higher-value civil claims — mainly for businesses and complex disputes.",
        links: byTitle.get("Financing Options").slice(1).map((r) => ({
          text: r.name,
          url: r.url,
        })),
      },
    ],
  },
  {
    title: "Home and Housing",
    resources: [
      wikiResource("Home and Housing", "Renting, buying, eviction, council housing, and repairs."),
      ...byTitle.get("Housing"),
    ],
  },
  {
    title: "Family and Relationships",
    resources: [
      wikiResource(
        "Family and Relationships",
        "Divorce, children, domestic abuse, marriage, and separation.",
      ),
      ...byTitle.get("Family"),
      ...byTitle.get("Domestic violence"),
      {
        name: "UK Deed Poll Office",
        description: "Support for you or your child's name-change process.",
        url: "https://www.ukdpo.com/",
      },
    ],
  },
  {
    title: "Wills and Planning Ahead",
    resources: WILLS_RESOURCES,
  },
  {
    title: "Work and Employment",
    resources: [
      wikiResource(
        "Work and Employment",
        "Rights at work, redundancy, tribunals, and employing staff in a small business.",
      ),
      ...byTitle.get("Employment"),
    ],
  },
  {
    title: "Your Business",
    resources: BUSINESS_RESOURCES,
  },
  {
    title: "Money, Benefits and Debt",
    resources: [
      wikiResource(
        "Money, Benefits and Debt",
        "Universal Credit, debt solutions, tax, council tax, and energy bills.",
      ),
      ...byTitle.get("Benefits, finance and debt"),
    ],
  },
  {
    title: "Consumer Rights",
    resources: CONSUMER_RESOURCES,
  },
  {
    title: "Neighbours and Property",
    resources: NEIGHBOURS_RESOURCES,
  },
  {
    title: "Immigration and Citizenship",
    resources: [
      wikiResource(
        "Immigration and Citizenship",
        "Visas, settled status, asylum, and British citizenship.",
      ),
      ...byTitle.get("Immigration and asylum"),
    ],
  },
  {
    title: "Health and Injury",
    resources: HEALTH_RESOURCES,
  },
  {
    title: "Driving and Parking",
    resources: [
      wikiResource(
        "Driving and Parking",
        "Motoring offences, parking fines (PCNs), and the Highway Code.",
      ),
      ...byTitle.get("Parking PCN"),
      {
        name: "Citizens Advice — parking tickets and PCNs",
        url: "https://www.citizensadvice.org.uk/consumer/parking-travel-leisure/parking-tickets/",
        description: "Challenge a council or private parking ticket.",
      },
    ],
  },
  {
    title: "Rights and Discrimination",
    resources: [
      wikiResource(
        "Rights and Discrimination",
        "Equality Act rights, human rights, and challenging unfair treatment.",
      ),
      ...byTitle.get("Human rights and public law"),
      ...byTitle.get("Disabilities and mental health"),
    ],
  },
  {
    title: "Crime and Police",
    resources: [
      wikiResource(
        "Crime and Police",
        "If you are accused of a crime, victim support, and fraud.",
      ),
      ...byTitle.get("Crime"),
      ...byTitle.get("Problem with Police"),
    ],
  },
  {
    title: "Education",
    resources: [
      wikiResource("Education", "School exclusions, SEND, and education rights for children and young people."),
      ...byTitle.get("Education"),
    ],
  },
];

if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(dataPath, backupPath);
  console.log("Backed up to", backupPath);
}

fs.writeFileSync(dataPath, JSON.stringify({ sections }, null, 2) + "\n", "utf8");
console.log("Wrote", dataPath, "—", sections.length, "sections");
