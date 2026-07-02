import Link from "next/link";
import { Search } from "lucide-react";
import { OslawPostList } from "@/components/oslaw/post-list";
import { OslawSubredditCard } from "@/components/oslaw/subreddit-card";
import { OslawTopicCard } from "@/components/oslaw/topic-card";
import { OslawSearchPanel } from "@/components/oslaw/oslaw-search-panel";
import { formatOslawScrapedAt } from "@/lib/oslaw/data";
import { OSLAW_REDDIT_APP_URL } from "@/lib/oslaw/config";
import { fetchLiveOslawTrendingData } from "@/lib/oslaw/live-trending";
import { engagementScore } from "@/lib/reddit-search/listing";

export async function OslawHubContent() {
  const { data, source } = await fetchLiveOslawTrendingData();
  const hasData = data.subreddits.length > 0;
  const isLive = source === "live" || source === "rss";

  const hottest = [...data.subreddits.flatMap((s) => s.posts)]
    .sort((a, b) => engagementScore(b) - engagementScore(a))
    .slice(0, 10);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <a
          href={OSLAW_REDDIT_APP_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-xl border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-medium text-foreground transition-all hover:-translate-y-0.5 hover:bg-gold/20 hover:shadow-sm"
        >
          OSLAW on Reddit
        </a>
        <Link
          href="/ask-the-shaman"
          className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 px-4 py-2 text-sm font-medium text-primary transition-all hover:-translate-y-0.5 hover:bg-primary/10 hover:shadow-sm"
        >
          <Search className="h-4 w-4" />
          Search directory
        </Link>
      </div>

      <div className="rounded-2xl border-2 border-gold/30 bg-card p-6 md:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium uppercase tracking-wide text-gold">OSLAW</p>
          {isLive ? (
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              {source === "rss" ? "Live via Reddit RSS" : "Live from Reddit"}
            </span>
          ) : (
            <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-200">
              Cached data
            </span>
          )}
        </div>
        <p className="mt-2 text-lg font-medium text-foreground">See what the internet is saying.</p>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          Live search and trending from UK legal and advice subreddits — housing, employment, parking,
          benefits, and council rules. Not legal advice.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Last updated: {formatOslawScrapedAt(data.meta.scrapedAt)}
          {isLive ? " · refreshed on page load" : ""}
        </p>
        <div className="mt-6">
          <OslawSearchPanel />
        </div>
      </div>

      {!hasData ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Could not reach Reddit right now. Use search above to retry, or check back shortly.
        </div>
      ) : (
        <>
          <section>
            <h2 className="font-serif text-xl font-semibold text-foreground">Trending legal topics</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.trendingTopics.map((topic) => (
                <OslawTopicCard key={topic.slug} topic={topic} />
              ))}
            </div>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-foreground">Legal subreddits</h2>
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              {data.subreddits.map((sub) => (
                <OslawSubredditCard key={sub.name} subreddit={sub} />
              ))}
            </div>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-foreground">Hottest posts</h2>
            <div className="mt-4">
              <OslawPostList posts={hottest} />
            </div>
          </section>
        </>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        OSLAW surfaces public Reddit discussions for research only — not legal advice.
      </p>
    </div>
  );
}
