import Link from "next/link";
import { formatGuideDate, latestGuides } from "@/lib/wiki/published";
import { wikiPagePublicPath } from "@/lib/wiki/public-url";

/**
 * Server rendered list of the newest who helps guides, so every new post is
 * linked from the homepage and Ask the Shaman in the initial HTML.
 */
export function LatestGuides({
  limit = 8,
  variant = "plain",
}: {
  limit?: number;
  variant?: "plain" | "landing";
}) {
  const guides = latestGuides(limit);
  if (!guides.length) return null;
  const landing = variant === "landing";

  return (
    <section
      aria-labelledby="latest-guides-heading"
      className={landing ? "relative py-12 md:py-16" : "relative z-10 mx-auto w-full max-w-4xl px-4 py-10"}
    >
      <div className={landing ? "relative mx-auto max-w-4xl px-4" : ""}>
        <div className={landing ? "mb-8 text-center" : "mb-6"}>
          <h2
            id="latest-guides-heading"
            className={
              landing
                ? "font-serif text-3xl font-bold text-foreground drop-shadow-sm md:text-4xl"
                : "font-serif text-2xl font-semibold text-foreground"
            }
          >
            Latest guides
          </h2>
          <p className={landing ? "mt-3 text-foreground/80 md:text-lg" : "mt-2 text-sm text-muted-foreground"}>
            New who helps guides for England and Wales. Signposting only, not legal advice.
          </p>
        </div>
        <ul
          className={
            landing
              ? "grid gap-4 rounded-[1.5rem] border border-white/30 bg-background/20 p-4 backdrop-blur-[2px] sm:grid-cols-2 md:p-6"
              : "grid gap-3 sm:grid-cols-2"
          }
        >
          {guides.map((guide) => (
            <li key={guide.id}>
              <Link
                href={wikiPagePublicPath(guide.id)}
                className={
                  landing
                    ? "block h-full rounded-xl border border-white/40 bg-background/40 p-4 transition-colors hover:bg-background/60"
                    : "block h-full rounded-xl border border-border/70 bg-card p-4 transition-colors hover:border-gold/40"
                }
              >
                <span className="text-xs uppercase tracking-wide text-gold">{guide.category}</span>
                <span className="mt-1 block font-medium text-foreground">{guide.title}</span>
                {guide.publishedAt ? (
                  <time dateTime={guide.publishedAt} className="mt-1 block text-xs text-muted-foreground">
                    {formatGuideDate(guide.publishedAt)}
                  </time>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
        <div className={landing ? "mt-8 text-center" : "mt-6"}>
          <Link
            href="/ask-the-shaman/who-helps"
            className="text-sm font-medium text-primary hover:underline"
          >
            See all who helps guides
          </Link>
          <span className="mx-2 text-muted-foreground">or</span>
          <Link href="/ask-the-shaman/wiki/Areas" className="text-sm font-medium text-primary hover:underline">
            browse guides by area
          </Link>
        </div>
      </div>
    </section>
  );
}
