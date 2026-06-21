import Link from "next/link";
import { Radio } from "lucide-react";
import { getOslawMarqueePosts } from "@/lib/oslaw/data";

export function OslawTrendingMarquee() {
  const posts = getOslawMarqueePosts();
  if (!posts.length) return null;

  const items = [...posts, ...posts];

  return (
    <div
      className="oslaw-marquee border-b-2 border-gold/40 bg-foreground text-primary-foreground"
      role="region"
      aria-label="Trending legal discussions from Reddit"
    >
      <div className="mx-auto flex max-w-6xl items-stretch">
        <div className="flex shrink-0 items-center gap-2 bg-gold px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-gold-foreground md:px-4">
          <Radio className="h-3.5 w-3.5 animate-pulse" aria-hidden />
          <span className="hidden sm:inline">OSLAW Trending</span>
          <span className="sm:hidden">Trending</span>
        </div>

        <div className="relative min-w-0 flex-1 overflow-hidden py-2.5">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-foreground to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-foreground to-transparent" />
          <div className="oslaw-marquee-track flex w-max items-center gap-0">
            {items.map((post, index) => (
              <span key={`${post.id}-${index}`} className="inline-flex shrink-0 items-center">
                <a
                  href={post.permalink || post.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-[min(100vw,28rem)] items-center gap-2 px-4 text-sm hover:underline md:max-w-md"
                >
                  <span className="shrink-0 rounded bg-primary/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground/90">
                    r/{post.subreddit}
                  </span>
                  <span className="truncate font-medium">{post.title}</span>
                </a>
                <span className="text-gold/60" aria-hidden>
                  ◆
                </span>
              </span>
            ))}
          </div>
        </div>

        <Link
          href="/oslaw"
          className="hidden shrink-0 items-center border-l border-gold/30 px-4 text-xs font-semibold uppercase tracking-wide text-gold hover:bg-gold/10 md:flex"
        >
          View all
        </Link>
      </div>
    </div>
  );
}
