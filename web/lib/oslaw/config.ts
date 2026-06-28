export type OslawSubredditConfig = {
  name: string;
  displayName: string;
  description: string;
};

/** Core UK legal subreddits — trending ingest and Devvit ticker. */
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

/** Extra communities for live OSLAW search (parking, motoring, council rules). */
export const OSLAW_SEARCH_EXTRA_SUBREDDITS: OslawSubredditConfig[] = [
  {
    name: "CarTalkUK",
    displayName: "r/CarTalkUK",
    description: "UK driving, parking fines, permits, and motoring disputes.",
  },
  {
    name: "AskUK",
    displayName: "r/AskUK",
    description: "Council services, parking rules, permits, and everyday UK regulatory questions.",
  },
];

/** All subreddits queried by OSLAW live search. */
export const OSLAW_SEARCH_SUBREDDITS: OslawSubredditConfig[] = [
  ...OSLAW_SUBREDDITS,
  ...OSLAW_SEARCH_EXTRA_SUBREDDITS,
];

export function listOslawSearchSubredditNames(): string[] {
  return OSLAW_SEARCH_SUBREDDITS.map((sub) => sub.name);
}

export function formatOslawSearchSubredditList(): string {
  return OSLAW_SEARCH_SUBREDDITS.map((sub) => sub.displayName).join(", ");
}

export const OSLAW_LISTING_LIMIT = 20;

export const OSLAW_LISTING_SOURCES: Array<{ sort: "hot" | "new" | "top"; time?: "day" }> = [
  { sort: "hot" },
  { sort: "top", time: "day" },
];

/** Legal Shaman Devvit app on Reddit (playtest or published install URL). */
export const OSLAW_REDDIT_APP_URL =
  process.env.NEXT_PUBLIC_OSLAW_REDDIT_APP_URL?.trim() ||
  "https://www.reddit.com/r/legalshaman_dev/?playtest=legalshaman";
