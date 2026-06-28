import Link from "next/link";
import { Search } from "lucide-react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { OslawTrendingMarquee } from "@/components/oslaw/trending-marquee";
import { OslawPostList } from "@/components/oslaw/post-list";
import { OslawSubredditCard } from "@/components/oslaw/subreddit-card";
import { OslawTopicCard } from "@/components/oslaw/topic-card";
import { OslawSearchPanel } from "@/components/oslaw/oslaw-search-panel";
import { formatOslawScrapedAt } from "@/lib/oslaw/data";
import { OSLAW_REDDIT_APP_URL } from "@/lib/oslaw/config";
import { fetchLiveOslawTrendingData } from "@/lib/oslaw/live-trending";
import { engagementScore } from "@/lib/reddit-search/listing";

export const metadata = {
  title: "OSLAW — Trending Legal Topics | Legal Shaman",
  description:
    "Open Source Law — live UK legal discussions from Reddit. Search parking, housing, employment, and more across UK advice subreddits.",
};

export default async function OslawPage() {
  const { data, source } = await fetchLiveOslawTrendingData();
  const hasData = data.subreddits.length > 0;
  const isLive = source === "live" || source === "rss";

  const hottest = [...data.subreddits.flatMap((s) => s.posts)]
    .sort((a, b) => engagementScore(b) - engagementScore(a))
    .slice(0, 10);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <OslawTrendingMarquee />
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:py-12">
        <div className="mb-8 flex flex-wrap items-center justify-end gap-3">
          <a
            href={OSLAW_REDDIT_APP_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-medium text-foreground transition-all hover:-translate-y-0.5 hover:bg-gold/20 hover:shadow-sm"
          >
            OSLAW on Reddit
          </a>
          <Link
            href="/search"
            className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 px-4 py-2 text-sm font-medium text-primary transition-all hover:-translate-y-0.5 hover:bg-primary/10 hover:shadow-sm"
          >
            <Search className="h-4 w-4" />
            Search directory
          </Link>
        </div>

        <div className="rounded-2xl border-2 border-gold/30 bg-card p-6 md:p-10">
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
          <h1 className="mt-2 font-serif text-3xl font-bold text-foreground md:text-4xl">
            Open Source Law
          </h1>
          <p className="mt-2 text-lg font-medium text-foreground">
            See what the internet is saying.
          </p>
          <p className="mt-4 max-w-3xl text-muted-foreground">
            Live search and trending from UK legal and advice subreddits — housing, employment,
            parking, benefits, and council rules. Not legal advice, but a useful pulse on what
            issues people are discussing right now.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated: {formatOslawScrapedAt(data.meta.scrapedAt)}
            {isLive ? " · refreshed on page load" : ""}
          </p>

          <OslawSearchPanel />
        </div>

        {!hasData ? (
          <div className="mt-10 rounded-xl border border-dashed border-border p-8 text-center">
            <p className="text-muted-foreground">
              Could not reach Reddit right now. Use search above to retry, or check back shortly.
            </p>
          </div>
        ) : (
          <>
            <section className="mt-12">
              <h2 className="font-serif text-2xl font-semibold text-foreground">Trending legal topics</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Clustered from hot and top posts across legal subreddits.
              </p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.trendingTopics.map((topic) => (
                  <OslawTopicCard key={topic.slug} topic={topic} />
                ))}
              </div>
            </section>

            <section className="mt-14">
              <h2 className="font-serif text-2xl font-semibold text-foreground">Legal subreddits</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Click a community to browse its latest discussions.
              </p>
              <div className="mt-6 grid gap-5 md:grid-cols-2">
                {data.subreddits.map((sub) => (
                  <OslawSubredditCard key={sub.name} subreddit={sub} />
                ))}
              </div>
            </section>

            <section className="mt-14">
              <h2 className="font-serif text-2xl font-semibold text-foreground">Hottest posts right now</h2>
              <p className="mt-1 text-sm text-muted-foreground">Top engagement across all tracked subreddits.</p>
              <div className="mt-6">
                <OslawPostList posts={hottest} />
              </div>
            </section>
          </>
        )}

        <p className="mt-12 text-xs leading-relaxed text-muted-foreground">
          OSLAW surfaces public Reddit discussions for research purposes only. Content is written by
          anonymous users and is not legal advice. Always consult a qualified solicitor for your
          situation.
        </p>
      </div>
      <Footer />
    </div>
  );
}
