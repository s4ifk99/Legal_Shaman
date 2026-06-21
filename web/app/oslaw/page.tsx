import Link from "next/link";
import { Search } from "lucide-react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { OslawTrendingMarquee } from "@/components/oslaw/trending-marquee";
import { OslawPostList } from "@/components/oslaw/post-list";
import { OslawSubredditCard } from "@/components/oslaw/subreddit-card";
import { OslawTopicCard } from "@/components/oslaw/topic-card";
import { Button } from "@/components/ui/button";
import { formatOslawScrapedAt, getOslawTrendingData } from "@/lib/oslaw/data";

export const metadata = {
  title: "OSLAW — Trending Legal Topics | Legal Shaman",
  description:
    "Open Source Law — see what the internet is saying. Trending UK legal discussions from Reddit, updated twice daily.",
};

export default function OslawPage() {
  const data = getOslawTrendingData();
  const hasData = data.subreddits.length > 0;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <OslawTrendingMarquee />
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:py-12">
        <div className="mb-8 flex flex-wrap items-center justify-end gap-3">
          <Link
            href="/search"
            className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 px-4 py-2 text-sm font-medium text-primary transition-all hover:-translate-y-0.5 hover:bg-primary/10 hover:shadow-sm"
          >
            <Search className="h-4 w-4" />
            Search directory
          </Link>
        </div>

        <div className="rounded-2xl border-2 border-gold/30 bg-card p-6 md:p-10">
          <p className="text-sm font-medium uppercase tracking-wide text-gold">OSLAW</p>
          <h1 className="mt-2 font-serif text-3xl font-bold text-foreground md:text-4xl">
            Open Source Law
          </h1>
          <p className="mt-2 text-lg font-medium text-foreground">
            See what the internet is saying.
          </p>
          <p className="mt-4 max-w-3xl text-muted-foreground">
            See what people are discussing on UK legal subreddits right now. Topics are scraped twice
            daily from community discussions — not legal advice, but a useful pulse on what issues are
            trending.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated: {formatOslawScrapedAt(data.meta.scrapedAt)}
          </p>

          <form action="/search" method="get" className="mt-6 flex max-w-xl flex-col gap-2 sm:flex-row">
            <input type="hidden" name="reddit" value="1" />
            <input
              name="q"
              placeholder="Search Reddit for a legal topic…"
              className="h-11 flex-1 rounded-lg border border-border bg-background px-4 text-foreground"
              minLength={2}
              required
            />
            <Button type="submit" className="h-11 gap-2 bg-gold text-gold-foreground hover:bg-gold/90">
              <Search className="h-4 w-4" />
              Search Reddit
            </Button>
          </form>
        </div>

        {!hasData ? (
          <div className="mt-10 rounded-xl border border-dashed border-border p-8 text-center">
            <p className="text-muted-foreground">
              Trending data has not been ingested yet. Run{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-sm">npm run reddit:trending:ingest</code>{" "}
              locally or wait for the scheduled scrape.
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
                <OslawPostList
                  posts={[...data.subreddits.flatMap((s) => s.posts)]
                    .sort((a, b) => b.score + b.numComments * 2 - (a.score + a.numComments * 2))
                    .slice(0, 10)}
                />
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
