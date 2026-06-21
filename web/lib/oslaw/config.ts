export type OslawSubredditConfig = {
  name: string;
  displayName: string;
  description: string;
};

/** UK-focused legal subreddits scraped for OSLAW trending. */
export const OSLAW_SUBREDDITS: OslawSubredditConfig[] = [
  {
    name: "LegalAdviceUK",
    displayName: "r/LegalAdviceUK",
    description: "Peer discussions on everyday UK legal problems — housing, work, family, police, and more.",
  },
  {
    name: "uklaw",
    displayName: "r/uklaw",
    description: "UK law students and practitioners — statute, case law, and professional practice.",
  },
  {
    name: "HousingUK",
    displayName: "r/HousingUK",
    description: "Renting, landlords, deposits, eviction, and housing rights in the UK.",
  },
  {
    name: "UKPersonalFinance",
    displayName: "r/UKPersonalFinance",
    description: "Debt, benefits, tax disputes, and consumer rights with legal crossover.",
  },
];

export const OSLAW_LISTING_LIMIT = 20;

export const OSLAW_LISTING_SOURCES: Array<{ sort: "hot" | "new" | "top"; time?: "day" }> = [
  { sort: "hot" },
  { sort: "top", time: "day" },
];
