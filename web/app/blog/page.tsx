import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { getWikiIndex } from "@/lib/wiki/load-index";
import {
  listWikiCategories,
  searchWikiPages,
  listFeaturedWikiPages,
} from "@/lib/wiki/search";
import { listGuidesNewestFirst } from "@/lib/wiki/published";
import { wikiPagePublicPath } from "@/lib/wiki/public-url";

export const metadata: Metadata = {
  title: "Blog: legal guidance and who helps guides",
  description:
    "Browse Legal Shaman’s indexed UK legal wiki: situation guides, who helps and practical next steps. Signposting only, not legal advice.",
  alternates: { canonical: "/blog" },
};

type PageProps = {
  searchParams: Promise<{ q?: string; category?: string }>;
};

export default async function BlogHubPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const q = (sp.q || "").trim();
  const categoryFilter = (sp.category || "").trim().toLowerCase();

  const index = getWikiIndex();
  const categories = listWikiCategories();
  const featured = listFeaturedWikiPages(8);
  const whoHelps = listGuidesNewestFirst().slice(0, 12);

  let results = q ? searchWikiPages(q, 40) : [];
  if (!q && categoryFilter) {
    results = index.pages
      .filter(
        (p) =>
          p.category.toLowerCase() === categoryFilter &&
          !p.relativePath.endsWith("_index.md"),
      )
      .slice(0, 40)
      .map((p) => ({
        id: p.id,
        title: p.title,
        category: p.category,
        summary: p.summary,
        keyInformation: p.keyInformation.slice(0, 5),
        practicalGuidance: p.practicalGuidance.slice(0, 4),
        relatedConcepts: p.relatedConcepts.slice(0, 6),
        relatedOrganisations: p.relatedOrganisations.slice(0, 4),
        score: 1,
      }));
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 md:py-12">
        <header className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gold">Knowledge hub</p>
          <h1 className="font-serif text-3xl font-bold text-foreground md:text-4xl">Blog</h1>
          <p className="max-w-2xl text-muted-foreground">
            All indexed wiki guidance in one place: situation explainers the Ask the Shaman agent
            cites. Your uploaded letters and photos stay private on Your case; they are never
            published here.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link
              href="/ask-the-shaman"
              className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Ask the Shaman
            </Link>
            <Link
              href="/financing"
              className="inline-flex h-10 items-center rounded-xl border border-border px-4 text-sm font-medium text-foreground hover:border-primary/40"
            >
              Financing
            </Link>
          </div>
        </header>

        <form className="mt-8" action="/blog" method="get">
          <label className="block text-sm font-medium text-foreground">
            Search guides
            <input
              name="q"
              defaultValue={q}
              placeholder="e.g. parking fine, deposit, eviction…"
              className="mt-1 w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm"
            />
          </label>
          <button
            type="submit"
            className="mt-3 inline-flex h-10 items-center rounded-xl border border-primary/40 bg-primary/5 px-4 text-sm font-medium text-primary hover:bg-primary/10"
          >
            Search
          </button>
        </form>

        <section className="mt-10">
          <h2 className="font-serif text-xl font-semibold text-foreground">Browse by category</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {categories.slice(0, 24).map(({ category, count }) => (
              <Link
                key={category}
                href={`/blog?category=${encodeURIComponent(category)}`}
                className="rounded-full border border-border/70 bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:border-gold/50"
              >
                <span className="capitalize">{category.replace(/_/g, " ")}</span>
                <span className="ml-1 text-muted-foreground">{count}</span>
              </Link>
            ))}
          </div>
        </section>

        {results.length > 0 ? (
          <section className="mt-10">
            <h2 className="font-serif text-xl font-semibold text-foreground">
              {q ? `Results for “${q}”` : `Category: ${categoryFilter}`}
            </h2>
            <ul className="mt-4 space-y-3">
              {results.map((page) => (
                <li key={page.id}>
                  <Link
                    href={wikiPagePublicPath(page.id)}
                    className="block rounded-xl border border-border/70 bg-card px-4 py-3 transition-colors hover:border-gold/40"
                  >
                    <span className="text-xs uppercase tracking-wide text-gold">
                      {page.category}
                    </span>
                    <span className="mt-1 block font-medium text-foreground">{page.title}</span>
                    {page.summary ? (
                      <span className="mt-1 block line-clamp-2 text-sm text-muted-foreground">
                        {page.summary.replace(/\*\*/g, "")}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <>
            <section className="mt-10">
              <h2 className="font-serif text-xl font-semibold text-foreground">Featured guides</h2>
              <ul className="mt-4 space-y-3">
                {featured.map((page) => (
                  <li key={page.id}>
                    <Link
                      href={wikiPagePublicPath(page.id)}
                      className="block rounded-xl border border-border/70 bg-card px-4 py-3 transition-colors hover:border-gold/40"
                    >
                      <span className="text-xs uppercase tracking-wide text-gold">
                        {page.category}
                      </span>
                      <span className="mt-1 block font-medium text-foreground">{page.title}</span>
                      {page.summary ? (
                        <span className="mt-1 block line-clamp-2 text-sm text-muted-foreground">
                          {page.summary.replace(/\*\*/g, "")}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section className="mt-10">
              <div className="flex items-end justify-between gap-3">
                <h2 className="font-serif text-xl font-semibold text-foreground">Who helps</h2>
                <Link
                  href="/ask-the-shaman/who-helps"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Full list →
                </Link>
              </div>
              <ul className="mt-4 space-y-3">
                {whoHelps.map((page) => (
                  <li key={page.id}>
                    <Link
                      href={wikiPagePublicPath(page.id)}
                      className="block rounded-xl border border-border/70 bg-card px-4 py-3 transition-colors hover:border-gold/40"
                    >
                      <span className="text-xs uppercase tracking-wide text-gold">
                        {page.category}
                      </span>
                      <span className="mt-1 block font-medium text-foreground">{page.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        <p className="mt-10 text-xs text-muted-foreground">
          Wiki indexed:{" "}
          {index.meta.indexedAt
            ? new Date(index.meta.indexedAt).toLocaleString("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
              })
            : "unknown"}
          {" · "}
          {index.meta.pageCount.toLocaleString("en-GB")} pages · Canonical articles remain at{" "}
          <code className="text-[11px]">/ask-the-shaman/wiki/…</code>
        </p>
      </main>
      <Footer />
    </div>
  );
}
