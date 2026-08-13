/**
 * Reddit × Ask-the-Shaman local eval (100 questions).
 *
 * Collects UK Reddit legal questions, runs runLegalKnowledgeSearch,
 * resolves influencer firms from firm-topic-recommendations.json,
 * and writes reports/reddit-shaman-eval-100.{json,md}.
 *
 * Usage:
 *   npm run reddit:shaman:eval
 *   npm run reddit:shaman:eval -- --limit=20
 *   npm run reddit:shaman:eval -- --collect-only
 *   npm run reddit:shaman:eval -- --skip-fetch   # reuse data/reddit-eval-100.json
 */
import "./load-dotenv";

import Module from "node:module";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

type NodeLoad = (request: string, parent: unknown, isMain: boolean) => unknown;
const nodeModule = Module as typeof Module & { _load: NodeLoad };
const load = nodeModule._load;
nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return load(request, parent, isMain);
};

const TARGET = 100;
const QUESTIONS_PATH = path.join(process.cwd(), "data/reddit-eval-100.json");
const REPORT_JSON = path.join(process.cwd(), "reports/reddit-shaman-eval-100.json");
const REPORT_MD = path.join(process.cwd(), "reports/reddit-shaman-eval-100.md");

const SKIP_TITLE =
  /\b(banned|generative ai|ai advice|megathread|weekly thread|daily thread|mod (post|announcement)|rules reminder|tldr news|labour.?s new renting)\b/i;

/** Extra Reddit-style UK legal questions used only when live Reddit fetch is rate-limited. */
const CURATED_REDDIT_STYLE: Array<{ title: string; snippet: string }> = [
  {
    title: "Landlord serving Section 21 after I complained about mould (England)",
    snippet:
      "I reported damp and mould three months ago. Now I've received a Section 21 notice. Assured shorthold tenancy. Can they do this and what are my options?",
  },
  {
    title: "Employer dismissed me after I raised a grievance about unpaid overtime",
    snippet:
      "Worked there 3 years. Raised a formal grievance about unpaid overtime, then got dismissed for 'performance'. Is this unfair dismissal or whistleblowing?",
  },
  {
    title: "Ex won't return my deposit from joint tenancy after I moved out",
    snippet:
      "England. Joint AST. Deposit was protected. I moved out, ex stayed. Agent says they can only return to both of us. How do I get my share?",
  },
  {
    title: "Police interviewed me under caution for alleged assault — what next?",
    snippet:
      "England. Voluntary interview. No charge yet. They took my phone. Should I get a solicitor and can I get my phone back?",
  },
  {
    title: "Visa refused — spouse visa financial requirement shortfall",
    snippet:
      "UK spouse visa refused because combined income was slightly under the threshold. Can we reapply with savings or appeal?",
  },
  {
    title: "Parking ticket from private company on residential estate",
    snippet:
      "Got a PCN from a private parking firm for parking in my visitor bay. Signs are unclear. Do I have to pay or can I appeal?",
  },
  {
    title: "Dad died without a will — how do we deal with the house?",
    snippet:
      "England. Intestate. Mum still alive, two adult children. House in dad's sole name. Do we need probate and who inherits?",
  },
  {
    title: "Universal Credit sanctioned after I missed an appointment",
    snippet:
      "Missed a Jobcentre appointment because I was in A&E. Now sanctioned. How do I challenge this and get payments restarted?",
  },
  {
    title: "Neighbour building a fence over the boundary line",
    snippet:
      "England. Title plan shows boundary. Neighbour put fence 30cm onto my garden. What steps before court?",
  },
  {
    title: "Bought faulty sofa — retailer refuses refund after 30 days",
    snippet:
      "Sofa broke within 6 weeks. Consumer Rights Act. They only offer repair. Can I reject and get a refund?",
  },
  {
    title: "Redundancy selection — I think I was chosen because I'm pregnant",
    snippet:
      "England. Redundancy pool of 4. I'm pregnant and was selected. Is this discrimination and what's the tribunal deadline?",
  },
  {
    title: "Bailiffs at the door for council tax arrears",
    snippet:
      "England. Council tax liability order. Bailiffs want to take my car. What can they take and can I arrange a payment plan?",
  },
  {
    title: "Child arrangements — other parent refusing contact",
    snippet:
      "England. No court order yet. Ex won't let me see our child. Do I need mediation before applying to court?",
  },
  {
    title: "Clinical negligence — delayed cancer diagnosis",
    snippet:
      "England. GP delayed referral. Now advanced stage. How do I start a clinical negligence claim and what are time limits?",
  },
  {
    title: "Leasehold service charges suddenly doubled",
    snippet:
      "England. Flat leasehold. Managing agent increased service charge 100%. Can I challenge at tribunal?",
  },
  {
    title: "Asylum claim — I missed my reporting event",
    snippet:
      "UK. Asylum seeker. Missed reporting due to illness. Worried about detention. What should I do?",
  },
  {
    title: "Company director — personal guarantee on business loan",
    snippet:
      "England. Ltd company insolvent. Bank calling on my personal guarantee. Can they take my home?",
  },
  {
    title: "Speeding — Notice of Intended Prosecution arrived late",
    snippet:
      "England. NIP arrived 21 days after alleged offence. Do I still have to respond?",
  },
  {
    title: "Domestic abuse — non-molestation order breached",
    snippet:
      "England. Ex breached NMO by texting. Police said it's civil. What should happen and can I get legal aid?",
  },
  {
    title: "PIP assessment — points too low, how to mandatory reconsider",
    snippet:
      "England. PIP decision wrong on mobility. How do I ask for mandatory reconsideration and what evidence helps?",
  },
  {
    title: "Shared ownership — can housing association refuse my sale?",
    snippet:
      "England. Want to sell shared ownership flat. HA delaying nomination period. What are my rights?",
  },
  {
    title: "Settlement agreement after redundancy — should I sign?",
    snippet:
      "England. Offered settlement with waiver of claims. 10 days to sign. Do I need independent legal advice?",
  },
  {
    title: "Builder took deposit and disappeared",
    snippet:
      "England. Paid £4k deposit for kitchen. Builder not responding. Small claims or trading standards?",
  },
  {
    title: "Lasting power of attorney — sibling won't let me see bank statements",
    snippet:
      "England. Sibling is attorney for mum. Refuses to share accounts. Can I report to OPG?",
  },
  {
    title: "Zero-hours — shifts cut after I asked for holiday pay",
    snippet:
      "England. Zero-hours contract. Asked about holiday pay then shifts stopped. Unlawful detriment?",
  },
  {
    title: "Eviction — Section 8 for rent arrears during illness",
    snippet:
      "England. Behind on rent after hospital stay. Section 8 notice. Can court still make a possession order?",
  },
  {
    title: "Discrimination at work — disability reasonable adjustments refused",
    snippet:
      "England. Requested WFH as adjustment for disability. Employer refused without assessment. Next steps?",
  },
  {
    title: "Divorce — how do we divide the pension?",
    snippet:
      "England. Contested divorce. Only major asset is workplace pension. Pension sharing order?",
  },
  {
    title: "Noise nuisance from upstairs flat — council won't act",
    snippet:
      "England. Nightly noise. Logged diary. Council says not statutory nuisance. Private nuisance claim?",
  },
  {
    title: "Habeas / immigration detention — how long can they hold me?",
    snippet:
      "UK. In immigration detention after visa overstay. No removal directions yet. Bail options?",
  },
  {
    title: "Consumer credit — car finance PPI style claim?",
    snippet:
      "England. Car on PCP. Think commission was unfair. Can I complain to lender/FOS?",
  },
  {
    title: "School exclusion — permanent exclusion for one fight",
    snippet:
      "England. Child permanently excluded. How do we appeal to IRP and what are deadlines?",
  },
  {
    title: "Judicial review of local authority housing decision",
    snippet:
      "England. Homelessness decision irrational. Pre-action protocol for JR — do I need a solicitor?",
  },
  {
    title: "HMRC IR35 — told I'm inside IR35 for contract role",
    snippet:
      "England. Contractor via umbrella. Client says inside IR35. Can I challenge the SDS?",
  },
];

type EvalQuestion = {
  id: string;
  title: string;
  snippet: string;
  url: string;
  subreddit: string;
  query: string;
  source?: "reddit" | "curated_reddit_style";
};

type EvalRow = {
  id: string;
  query: string;
  title: string;
  subreddit: string;
  url: string;
  area: string;
  subArea: string;
  specificIssue?: string;
  confidence: number;
  confidenceBand: "high" | "medium" | "low";
  answerMode?: string;
  wikiSources: Array<{ title: string; source: string; score: number }>;
  answerExcerpt: string | null;
  influencerFirms: Array<{ firm: string; practiceArea: string; article_count: number; directory_url: string }>;
  directoryFirms: Array<{ title: string; score: number; locationLabel?: string }>;
  flags: string[];
  error?: string;
};

function parseArg(argv: string[], name: string): string | null {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=").trim() : null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function confidenceBand(score: number): "high" | "medium" | "low" {
  if (score >= 0.68) return "high";
  if (score >= 0.38) return "medium";
  return "low";
}

function isLikelyLegalQuestion(title: string, snippet: string): boolean {
  if (SKIP_TITLE.test(title)) return false;
  const blob = `${title} ${snippet}`.toLowerCase();
  // Prefer first-person / advice-seeking posts
  const adviceCue =
    /\b(i |my |our |landlord|tenant|employer|evict|deposit|dismiss|tribunal|visa|asylum|divorce|bailiff|parking|pcn|police|arrest|debt|benefit|probate|will |solicitor|court|claim)\b/i.test(
      blob,
    );
  return adviceCue || title.includes("?");
}

async function collectQuestions(limit: number): Promise<EvalQuestion[]> {
  const { fetchSubredditListing, dedupeOslawPosts } = await import("../lib/reddit-search/listing");
  const { OSLAW_SUBREDDITS, OSLAW_SEARCH_EXTRA_SUBREDDITS } = await import("../lib/oslaw/config");

  const questions: EvalQuestion[] = [];
  const seenTitles = new Set<string>();

  const pushQ = (q: EvalQuestion) => {
    const key = q.title.toLowerCase().replace(/\s+/g, " ").trim();
    if (seenTitles.has(key)) return;
    seenTitles.add(key);
    questions.push(q);
  };

  // Keep previously collected live Reddit questions if present.
  if (existsSync(QUESTIONS_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(QUESTIONS_PATH, "utf8")) as { questions?: EvalQuestion[] };
      for (const q of prev.questions ?? []) {
        if (q.source === "curated_reddit_style") continue;
        pushQ({ ...q, source: q.source ?? "reddit" });
      }
    } catch {
      /* ignore */
    }
  }

  const subs = [
    ...OSLAW_SUBREDDITS.filter((s) => s.name === "LegalAdviceUK" || s.name === "HousingUK"),
    ...OSLAW_SUBREDDITS.filter((s) => s.name !== "LegalAdviceUK" && s.name !== "HousingUK"),
    ...OSLAW_SEARCH_EXTRA_SUBREDDITS.filter((s) => s.name === "CarTalkUK"),
  ];

  const sorts: Array<{ sort: "hot" | "new" | "top"; time?: "week" | "day"; limit: number }> = [
    { sort: "hot", limit: 50 },
    { sort: "new", limit: 50 },
    { sort: "top", time: "week", limit: 50 },
    { sort: "top", time: "day", limit: 40 },
  ];

  const all = [];
  for (const sub of subs) {
    if (questions.length >= limit) break;
    for (const source of sorts) {
      try {
        const batch = await fetchSubredditListing(sub.name, {
          sort: source.sort,
          time: source.time,
          limit: source.limit,
        });
        all.push(...batch.posts);
        console.info(
          JSON.stringify({
            event: "reddit_fetched",
            subreddit: sub.name,
            sort: source.sort,
            time: source.time ?? null,
            count: batch.posts.length,
            listingSource: batch.source,
          }),
        );
      } catch (err) {
        console.warn(
          JSON.stringify({
            event: "reddit_fetch_error",
            subreddit: sub.name,
            sort: source.sort,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
      await sleep(1200);
      if (dedupeOslawPosts(all).length >= limit * 3) break;
    }
  }

  const trendingPath = path.join(process.cwd(), "data/reddit-trending.json");
  if (existsSync(trendingPath)) {
    try {
      const trending = JSON.parse(readFileSync(trendingPath, "utf8")) as {
        subreddits?: Array<{ posts?: typeof all }>;
      };
      for (const snap of trending.subreddits ?? []) {
        for (const p of snap.posts ?? []) all.push(p);
      }
    } catch {
      /* ignore */
    }
  }

  for (const p of dedupeOslawPosts(all)) {
    if (questions.length >= limit) break;
    if (!isLikelyLegalQuestion(p.title, p.snippet)) continue;
    const snippet = (p.snippet || "").slice(0, 400);
    pushQ({
      id: p.id,
      title: p.title.trim(),
      snippet,
      url: p.permalink || p.url,
      subreddit: p.subreddit,
      query: [p.title.trim(), snippet].filter(Boolean).join(". ").slice(0, 700),
      source: "reddit",
    });
  }

  if (questions.length < limit) {
    let i = 0;
    for (const c of CURATED_REDDIT_STYLE) {
      if (questions.length >= limit) break;
      i += 1;
      const snippet = c.snippet.slice(0, 400);
      pushQ({
        id: `curated-${i}`,
        title: c.title,
        snippet,
        url: "https://www.reddit.com/r/LegalAdviceUK/",
        subreddit: "LegalAdviceUK",
        query: `${c.title}. ${snippet}`.slice(0, 700),
        source: "curated_reddit_style",
      });
    }
  }

  return questions.slice(0, limit);
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

async function evaluateOne(q: EvalQuestion): Promise<EvalRow> {
  const { runLegalKnowledgeSearch } = await import("../lib/legal-knowledge/search");
  const { searchWikiPages } = await import("../lib/wiki/search");
  const { pickRecommendedFirms } = await import("../lib/wiki/firm-recommendations");

  const flags: string[] = [];
  let row: EvalRow = {
    id: q.id,
    query: q.query,
    title: q.title,
    subreddit: q.subreddit,
    url: q.url,
    area: "",
    subArea: "",
    confidence: 0,
    confidenceBand: "low",
    wikiSources: [],
    answerExcerpt: null,
    influencerFirms: [],
    directoryFirms: [],
    flags,
  };

  const wikiHits = searchWikiPages(q.query, 8);
  const influencer = pickRecommendedFirms(q.query, wikiHits, 5).map((f) => ({
    firm: f.firm,
    practiceArea: f.practiceArea,
    article_count: f.article_count,
    directory_url: f.directory_url,
  }));
  row.influencerFirms = influencer;

  try {
    const includeDirectory = !process.env.REDDIT_EVAL_SKIP_DIRECTORY;
    const result = await runLegalKnowledgeSearch({
      query: q.query,
      includeDirectory,
    });
    row.area = result.issueClassification.area;
    row.subArea = result.issueClassification.subArea;
    row.specificIssue = result.issueClassification.specificIssue;
    row.confidence = result.confidence;
    row.confidenceBand = confidenceBand(result.confidence);
    row.answerMode = result.answerMode;
    row.wikiSources = result.sources.slice(0, 5).map((s) => ({
      title: s.title,
      source: s.source,
      score: s.score,
    }));
    row.answerExcerpt = result.answer ? result.answer.replace(/\s+/g, " ").trim().slice(0, 420) : null;
    row.directoryFirms = result.directoryResults.slice(0, 5).map((d) => ({
      title: d.title,
      score: d.score,
      locationLabel: d.locationLabel,
    }));
    if (result.clarifyingQuestion) flags.push("clarifying_question");
    if (!result.sources.length) flags.push("no_wiki_sources");
    if (!influencer.length && !result.directoryResults.length) flags.push("no_solicitor");
    if (row.confidenceBand === "low") flags.push("low_confidence");
  } catch (err) {
    row.error = err instanceof Error ? err.message : String(err);
    flags.push("search_error");
    // Lexical fallback sources for the report
    row.wikiSources = wikiHits.slice(0, 5).map((h) => ({
      title: h.title,
      source: h.category,
      score: h.score,
    }));
    if (!wikiHits.length) flags.push("no_wiki_sources");
    if (!influencer.length) flags.push("no_solicitor");
    // Rough confidence from lexical score
    const top = wikiHits[0]?.score ?? 0;
    row.confidence = Math.min(0.95, top / 40);
    row.confidenceBand = confidenceBand(row.confidence);
    row.answerMode = "lexical_fallback";
    row.area = wikiHits[0]?.category || "unknown";
    row.subArea = "";
  }

  row.flags = [...new Set(flags)];
  return row;
}

function writeMarkdown(rows: EvalRow[], questionsMeta: { collectedAt: string; count: number }) {
  const bands = { high: 0, medium: 0, low: 0 };
  let withWiki = 0;
  let withFirm = 0;
  let withDirectory = 0;
  let withInfluencer = 0;
  let errors = 0;
  for (const r of rows) {
    bands[r.confidenceBand]++;
    if (r.wikiSources.length) withWiki++;
    if (r.influencerFirms.length || r.directoryFirms.length) withFirm++;
    if (r.directoryFirms.length) withDirectory++;
    if (r.influencerFirms.length) withInfluencer++;
    if (r.error) errors++;
  }
  const n = rows.length || 1;

  const lines: string[] = [
    `# Reddit × Shaman eval (n=${rows.length})`,
    "",
    `Collected: ${questionsMeta.collectedAt}`,
    "",
    "## Summary",
    "",
    `| Metric | Count | Rate |`,
    `|---|---:|---:|`,
    `| High confidence (≥0.68) | ${bands.high} | ${((100 * bands.high) / n).toFixed(0)}% |`,
    `| Medium confidence (≥0.38) | ${bands.medium} | ${((100 * bands.medium) / n).toFixed(0)}% |`,
    `| Low confidence (<0.38) | ${bands.low} | ${((100 * bands.low) / n).toFixed(0)}% |`,
    `| ≥1 wiki source | ${withWiki} | ${((100 * withWiki) / n).toFixed(0)}% |`,
    `| ≥1 solicitor (any) | ${withFirm} | ${((100 * withFirm) / n).toFixed(0)}% |`,
    `| Influencer firms (5+ articles) | ${withInfluencer} | ${((100 * withInfluencer) / n).toFixed(0)}% |`,
    `| Directory firms | ${withDirectory} | ${((100 * withDirectory) / n).toFixed(0)}% |`,
    `| Search errors | ${errors} | ${((100 * errors) / n).toFixed(0)}% |`,
    "",
    "## Area distribution",
    "",
  ];

  const areaCounts = new Map<string, number>();
  for (const r of rows) {
    const a = r.area || "unknown";
    areaCounts.set(a, (areaCounts.get(a) ?? 0) + 1);
  }
  for (const [area, count] of [...areaCounts.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`- **${area}**: ${count}`);
  }

  lines.push("", "## All results", "");
  lines.push(
    "| # | Confidence | Band | Area | Top wiki source | Influencer firms | Directory | Title |",
  );
  lines.push("|---:|---:|---|---|---|---|---|---|");

  rows.forEach((r, i) => {
    const top = r.wikiSources[0]?.title?.replace(/\|/g, "/") ?? "—";
    const firms =
      r.influencerFirms
        .slice(0, 2)
        .map((f) => f.firm)
        .join("; ") || "—";
    const dir =
      r.directoryFirms
        .slice(0, 2)
        .map((f) => f.title)
        .join("; ") || "—";
    const title = r.title.replace(/\|/g, "/").slice(0, 80);
    lines.push(
      `| ${i + 1} | ${r.confidence.toFixed(2)} | ${r.confidenceBand} | ${r.area || "—"} | ${top.slice(0, 60)} | ${firms.slice(0, 50)} | ${dir.slice(0, 40)} | ${title} |`,
    );
  });

  lines.push("", "## Spot checks (sample excerpts)", "");
  for (const r of rows.filter((x) => x.answerExcerpt).slice(0, 8)) {
    lines.push(`### ${r.title}`);
    lines.push("");
    lines.push(`- Area: **${r.area}** / ${r.subArea} (confidence ${r.confidence.toFixed(2)}, mode=${r.answerMode ?? "—"})`);
    lines.push(`- Firms: ${r.influencerFirms.map((f) => f.firm).join(", ") || "none"}`);
    lines.push(`- Excerpt: ${r.answerExcerpt}`);
    lines.push("");
  }

  lines.push("", "## Low-confidence or error cases", "");
  for (const r of rows.filter((x) => x.confidenceBand === "low" || x.error).slice(0, 15)) {
    lines.push(
      `- **${r.title}** — conf=${r.confidence.toFixed(2)} area=${r.area || "?"} flags=${r.flags.join(",")}${r.error ? ` error=${r.error}` : ""}`,
    );
  }
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const limit = Math.min(200, Math.max(1, Number(parseArg(argv, "limit") ?? TARGET) || TARGET));
  const collectOnly = argv.includes("--collect-only");
  const skipFetch = argv.includes("--skip-fetch");
  const concurrency = Math.min(4, Math.max(1, Number(parseArg(argv, "concurrency") ?? 2) || 2));

  mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
  mkdirSync(path.join(process.cwd(), "reports"), { recursive: true });

  let questions: EvalQuestion[] = [];
  if (skipFetch && existsSync(QUESTIONS_PATH)) {
    const cached = JSON.parse(readFileSync(QUESTIONS_PATH, "utf8")) as {
      questions: EvalQuestion[];
    };
    questions = (cached.questions ?? []).slice(0, limit);
    console.info(JSON.stringify({ event: "questions_loaded", count: questions.length }));
  } else {
    questions = await collectQuestions(limit);
    const payload = {
      collectedAt: new Date().toISOString(),
      count: questions.length,
      target: limit,
      questions,
    };
    writeFileSync(QUESTIONS_PATH, JSON.stringify(payload, null, 2));
    console.info(
      JSON.stringify({
        event: "questions_written",
        path: QUESTIONS_PATH,
        count: questions.length,
        target: limit,
      }),
    );
  }

  if (questions.length < limit) {
    console.warn(
      JSON.stringify({
        event: "questions_shortfall",
        got: questions.length,
        wanted: limit,
        note: "Proceeding with available questions",
      }),
    );
  }

  if (collectOnly) return;

  console.info(JSON.stringify({ event: "eval_start", count: questions.length, concurrency }));
  const rows = await mapPool(questions, concurrency, async (q, i) => {
    const row = await evaluateOne(q);
    console.info(
      JSON.stringify({
        event: "eval_row",
        i: i + 1,
        n: questions.length,
        id: q.id,
        confidence: row.confidence,
        band: row.confidenceBand,
        area: row.area,
        sources: row.wikiSources.length,
        firms: row.influencerFirms.length + row.directoryFirms.length,
        error: row.error ?? null,
      }),
    );
    return row;
  });

  const meta = {
    collectedAt: new Date().toISOString(),
    count: rows.length,
  };
  const report = {
    meta,
    summary: {
      high: rows.filter((r) => r.confidenceBand === "high").length,
      medium: rows.filter((r) => r.confidenceBand === "medium").length,
      low: rows.filter((r) => r.confidenceBand === "low").length,
      withWikiSources: rows.filter((r) => r.wikiSources.length > 0).length,
      withSolicitor: rows.filter((r) => r.influencerFirms.length || r.directoryFirms.length).length,
      withInfluencer: rows.filter((r) => r.influencerFirms.length > 0).length,
      withDirectory: rows.filter((r) => r.directoryFirms.length > 0).length,
      errors: rows.filter((r) => r.error).length,
    },
    rows,
  };

  writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
  writeFileSync(REPORT_MD, writeMarkdown(rows, meta));
  console.info(JSON.stringify({ event: "eval_done", json: REPORT_JSON, md: REPORT_MD, summary: report.summary }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
