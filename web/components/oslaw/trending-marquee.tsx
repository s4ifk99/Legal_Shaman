import { getOslawMarqueePosts } from "@/lib/oslaw/data";

function formatTickerTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  }).format(d);
}

export function OslawTrendingMarquee() {
  const posts = getOslawMarqueePosts(48);
  if (!posts.length) return null;

  const items = [...posts, ...posts, ...posts];

  return (
    <div
      className="oslaw-marquee border-b border-gold/30 bg-foreground text-primary-foreground"
      role="region"
      aria-label="Live legal discussion ticker from Reddit"
    >
      <div className="relative overflow-hidden py-2">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-foreground to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-foreground to-transparent" />
        <div className="oslaw-marquee-track flex w-max items-center">
          {items.map((post, index) => (
            <span
              key={`${post.id}-${index}`}
              className="oslaw-ticker-item inline-flex shrink-0 items-center whitespace-nowrap px-6"
            >
              <a
                href={post.permalink || post.url}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11px] uppercase tracking-wide text-primary-foreground/95 hover:text-gold md:text-xs"
              >
                <span className="text-gold">r/{post.subreddit}</span>
                <span className="text-primary-foreground/40"> · </span>
                <span>{post.title}</span>
                <span className="text-primary-foreground/40"> · </span>
                <span className="text-primary-foreground/70">
                  {formatTickerTime(post.createdUtc)} · ↑{post.score}
                </span>
              </a>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
