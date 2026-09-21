/**
 * Daily Reddit pick for Blog Queue automation.
 *
 * Harvests r/LegalAdviceUK (new + hot RSS), scores everyday searchable shapes,
 * appends to the query bank, writes a dated brief JSON.
 *
 * Usage: npm run reddit:daily-pick
 * Optional: PICK_COUNT=10 BRIEF_DATE=2026-09-21
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import "./load-dotenv";

import { fetchSubredditHotRss, fetchSubredditNewRss } from "../lib/reddit-search/rss";
import type { LiveRedditSearchResult } from "../lib/reddit-search/types";

const PICK_COUNT = Math.max(1, Number(process.env.PICK_COUNT ?? 10) || 10);
const BANK_PATH = resolve(process.cwd(), "data/reddit-query-bank.json");
const BRIEF_DIR = resolve(process.cwd(), "data/reddit-daily-brief");
const LOOKBACK_DAYS = 30;

type Matter =
  | "consumer"
  | "parking"
  | "employment"
  | "housing"
  | "neighbours"
  | "crime"
  | "other";

type BankEntry = {
  id: string;
  titleShape: string;
  matterGuess: Matter;
  subreddit: string;
  pickedAt: string;
  normalisedTitle: string;
};

type BankFile = {
  version: number;
  updatedAt: string | null;
  entries: BankEntry[];
};

type PickRow = {
  id: string;
  title: string;
  titleShape: string;
  matterGuess: Matter;
  subreddit: string;
  score: number;
  whyPicked: string;
  everyday: boolean;
  normalisedTitle: string;
};

const SKIP_RE =
  /\b(us\b|usa|american|which solicitor|best solicitor|mortgage deal|relationship advice|dating|tinder)\b/i;

const MATTER_RULES: Array<{ matter: Matter; re: RegExp; everyday: boolean }> = [
  {
    matter: "parking",
    re: /\b(parking|pcn|popla|ticket|clamp|private land)\b/i,
    everyday: true,
  },
  {
    matter: "consumer",
    re: /\b(refund|parcel|courier|section\s*75|chargeback|garage|plumber|faulty|train|ticket|store return|gym|energy)\b/i,
    everyday: true,
  },
  {
    matter: "employment",
    re: /\b(dismiss|fired|sacked|maternity|pregnancy|acas|zero.?hours|payslip|holiday pay|redundan)\b/i,
    everyday: true,
  },
  {
    matter: "neighbours",
    re: /\b(drone|cctv|neighbour|neighbor|noise|nuisance|ico)\b/i,
    everyday: true,
  },
  {
    matter: "crime",
    re: /\b(hit and run|police|bail|fraud|theft|assault)\b/i,
    everyday: false,
  },
  {
    matter: "housing",
    re: /\b(landlord|tenant|deposit|evict|rent|leasehold|ground rent|sewer|flood|disrepair)\b/i,
    everyday: false,
  },
];

function londonDateIso(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleShape(title: string): string {
  return title
    .replace(/\b(i|my|me|we|our)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function guessMatter(title: string): { matter: Matter; everyday: boolean } {
  for (const rule of MATTER_RULES) {
    if (rule.re.test(title)) return { matter: rule.matter, everyday: rule.everyday };
  }
  return { matter: "other", everyday: false };
}

function scorePost(title: string): { score: number; everyday: boolean; why: string[] } {
  const why: string[] = [];
  let score = 0;
  if (SKIP_RE.test(title)) return { score: -100, everyday: false, why: ["skip pattern"] };

  const { matter, everyday } = guessMatter(title);
  if (everyday) {
    score += 40;
    why.push("everyday");
  } else if (matter !== "other") {
    score += 15;
    why.push(`matter:${matter}`);
  }

  if (/\?|what (do|can|should) i|who (helps|do i)|can i |am i /i.test(title)) {
    score += 25;
    why.push("search-shaped");
  }
  if (title.length >= 28 && title.length <= 140) {
    score += 10;
    why.push("title length");
  }
  if (/\b(england|uk|scotland|wales)\b/i.test(title)) {
    score += 5;
    why.push("uk cue");
  }
  return { score, everyday, why };
}

function loadBank(): BankFile {
  if (!existsSync(BANK_PATH)) {
    return { version: 1, updatedAt: null, entries: [] };
  }
  try {
    return JSON.parse(readFileSync(BANK_PATH, "utf8")) as BankFile;
  } catch {
    return { version: 1, updatedAt: null, entries: [] };
  }
}

function recentNormalised(bank: BankFile, days: number): Set<string> {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const set = new Set<string>();
  for (const e of bank.entries) {
    const t = Date.parse(e.pickedAt);
    if (Number.isFinite(t) && t >= cutoff) set.add(e.normalisedTitle);
  }
  return set;
}

async function harvest(): Promise<LiveRedditSearchResult[]> {
  const subs = ["LegalAdviceUK", "HousingUK", "UKPersonalFinance", "CarTalkUK"];
  const all: LiveRedditSearchResult[] = [];
  for (const sub of subs) {
    try {
      const [hot, neu] = await Promise.all([
        fetchSubredditHotRss(sub, 40),
        fetchSubredditNewRss(sub, 40),
      ]);
      all.push(...hot, ...neu);
    } catch (err) {
      console.warn(
        JSON.stringify({
          event: "daily_pick_rss_error",
          subreddit: sub,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  const byId = new Map<string, LiveRedditSearchResult>();
  for (const p of all) {
    const id = p.id.replace(/^t3_/, "").split("/").pop() || p.id;
    const clean = { ...p, id };
    if (!byId.has(clean.id) || (byId.get(clean.id)!.createdUtc ?? 0) < (clean.createdUtc ?? 0)) {
      byId.set(clean.id, clean);
    }
  }
  return Array.from(byId.values());
}

async function main() {
  const date = process.env.BRIEF_DATE?.trim() || londonDateIso();
  const bank = loadBank();
  const recent = recentNormalised(bank, LOOKBACK_DAYS);
  const posts = await harvest();

  const candidates: PickRow[] = [];
  for (const post of posts) {
    const normalised = normaliseTitle(post.title);
    if (!normalised || recent.has(normalised)) continue;
    const { score, everyday, why } = scorePost(post.title);
    if (score < 20) continue;
    const { matter } = guessMatter(post.title);
    candidates.push({
      id: post.id.replace(/^t3_/, ""),
      title: post.title,
      titleShape: titleShape(post.title),
      matterGuess: matter,
      subreddit: post.subreddit.replace(/^r\//, ""),
      score,
      whyPicked: why.join(", "),
      everyday,
      normalisedTitle: normalised,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  const picks: PickRow[] = [];
  const matterCounts: Record<string, number> = {};
  let housingCount = 0;

  for (const c of candidates) {
    if (picks.length >= PICK_COUNT) break;
    if (picks.some((p) => p.normalisedTitle === c.normalisedTitle)) continue;
    if (c.matterGuess === "housing" && housingCount >= 3) continue;
    const mCount = matterCounts[c.matterGuess] ?? 0;
    if (mCount >= 4 && c.matterGuess !== "consumer") continue;
    picks.push(c);
    matterCounts[c.matterGuess] = mCount + 1;
    if (c.matterGuess === "housing") housingCount += 1;
  }

  // Prefer at least 6 everyday if available
  const everydayAvailable = candidates.filter((c) => c.everyday);
  if (picks.filter((p) => p.everyday).length < Math.min(6, everydayAvailable.length)) {
    for (const c of everydayAvailable) {
      if (picks.length >= PICK_COUNT) break;
      if (picks.some((p) => p.id === c.id)) continue;
      if (picks.some((p) => p.normalisedTitle === c.normalisedTitle)) continue;
      picks.push(c);
    }
    picks.sort((a, b) => b.score - a.score);
    picks.splice(PICK_COUNT);
  }

  const nowIso = new Date().toISOString();
  for (const p of picks) {
    bank.entries.push({
      id: p.id,
      titleShape: p.titleShape,
      matterGuess: p.matterGuess,
      subreddit: p.subreddit,
      pickedAt: nowIso,
      normalisedTitle: p.normalisedTitle,
    });
  }
  bank.updatedAt = nowIso;
  writeFileSync(BANK_PATH, JSON.stringify(bank, null, 2) + "\n", "utf8");

  mkdirSync(BRIEF_DIR, { recursive: true });
  const briefPath = resolve(BRIEF_DIR, `${date}.json`);
  const brief = {
    date,
    generatedAt: nowIso,
    pickCount: picks.length,
    thinDay: picks.length < PICK_COUNT,
    note:
      picks.length < PICK_COUNT
        ? `Thin day: only ${picks.length} of ${PICK_COUNT} high-quality picks.`
        : null,
    picks: picks.map((p) => ({
      id: p.id,
      title: p.title,
      titleShape: p.titleShape,
      matterGuess: p.matterGuess,
      subreddit: p.subreddit,
      score: p.score,
      whyPicked: p.whyPicked,
      everyday: p.everyday,
    })),
  };
  writeFileSync(briefPath, JSON.stringify(brief, null, 2) + "\n", "utf8");

  console.log(
    JSON.stringify({
      event: "reddit_daily_pick_done",
      date,
      pickCount: picks.length,
      thinDay: brief.thinDay,
      briefPath,
      bankEntries: bank.entries.length,
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
