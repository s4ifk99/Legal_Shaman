import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { OslawPostList } from "@/components/oslaw/post-list";
import { OSLAW_SUBREDDITS } from "@/lib/oslaw/config";
import { getOslawTrendingData } from "@/lib/oslaw/data";

type PageProps = {
  params: Promise<{ subreddit: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { subreddit } = await params;
  const config = OSLAW_SUBREDDITS.find((s) => s.name.toLowerCase() === subreddit.toLowerCase());
  return {
    title: config ? `${config.displayName} — OSLAW | Legal Shaman` : "Subreddit — OSLAW",
  };
}

export default async function OslawSubredditPage({ params }: PageProps) {
  const { subreddit: rawName } = await params;
  const config = OSLAW_SUBREDDITS.find((s) => s.name.toLowerCase() === rawName.toLowerCase());
  if (!config) notFound();

  const data = getOslawTrendingData();
  const snapshot = data.subreddits.find((s) => s.name.toLowerCase() === config.name.toLowerCase());

  if (!snapshot) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Link href="/ask-the-shaman" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to OSLAW
        </Link>
        <h1 className="mt-6 font-serif text-3xl font-bold">{config.displayName}</h1>
        <p className="mt-4 text-muted-foreground">
          No scraped posts yet for this subreddit. Run the ingest job or check back after the next
          scheduled update.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-8 md:py-12">
        <Link
          href="/ask-the-shaman"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to OSLAW
        </Link>

        <div className="mt-6">
          <p className="text-sm font-medium uppercase tracking-wide text-gold">OSLAW subreddit</p>
          <h1 className="mt-2 font-serif text-3xl font-bold text-foreground">{snapshot.displayName}</h1>
          <p className="mt-4 leading-relaxed text-muted-foreground">{snapshot.description}</p>
          {snapshot.subscribers ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {snapshot.subscribers.toLocaleString("en-GB")} members
            </p>
          ) : null}
        </div>

        <section className="mt-10">
          <h2 className="font-serif text-xl font-semibold">Trending posts</h2>
          <div className="mt-4">
            <OslawPostList posts={snapshot.posts} emptyMessage="No posts scraped for this subreddit yet." />
          </div>
        </section>

        <form action="/search" method="get" className="mt-10 rounded-xl border border-gold/30 bg-card p-5">
          <p className="text-sm font-medium text-foreground">Search this topic on Reddit</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input type="hidden" name="reddit" value="1" />
            <input
              name="q"
              placeholder={`Search ${config.displayName}…`}
              className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
              minLength={2}
              required
            />
            <button
              type="submit"
              className="h-10 rounded-lg bg-gold px-4 text-sm font-semibold text-gold-foreground hover:bg-gold/90"
            >
              Search Reddit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
