import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { OslawPostList } from "@/components/oslaw/post-list";
import { getOslawTrendingData } from "@/lib/oslaw/data";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const data = getOslawTrendingData();
  const topic = data.trendingTopics.find((t) => t.slug === slug);
  return {
    title: topic ? `${topic.label} — OSLAW | Legal Shaman` : "Topic — OSLAW",
  };
}

export default async function OslawTopicPage({ params }: PageProps) {
  const { slug } = await params;
  const data = getOslawTrendingData();
  const topic = data.trendingTopics.find((t) => t.slug === slug);
  if (!topic) notFound();

  const searchQuery = topic.label;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-8 md:py-12">
        <Link
          href="/oslaw"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to OSLAW
        </Link>

        <div className="mt-6">
          <p className="text-sm font-medium uppercase tracking-wide text-gold">Trending topic</p>
          <h1 className="mt-2 font-serif text-3xl font-bold text-foreground">{topic.label}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {topic.postCount} related posts · {topic.subreddits.map((s) => `r/${s}`).join(", ")}
          </p>
        </div>

        <section className="mt-10">
          <OslawPostList posts={topic.posts} />
        </section>

        <form action="/search" method="get" className="mt-10 rounded-xl border border-gold/30 bg-card p-5">
          <p className="text-sm font-medium text-foreground">Search directory + Reddit for this topic</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input type="hidden" name="reddit" value="1" />
            <input
              name="q"
              defaultValue={searchQuery}
              className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
              minLength={2}
              required
            />
            <button
              type="submit"
              className="h-10 rounded-lg bg-gold px-4 text-sm font-semibold text-gold-foreground hover:bg-gold/90"
            >
              Search
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
