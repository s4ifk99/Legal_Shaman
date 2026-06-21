import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { AskShamanSearch } from "@/components/wiki/ask-shaman-search";
import { Card, CardContent } from "@/components/ui/card";
import { getWikiIndex } from "@/lib/wiki/load-index";
import { listFeaturedWikiPages, listWikiCategories } from "@/lib/wiki/search";

export const metadata: Metadata = {
  title: "Ask the Shaman | Legal Shaman",
  description:
    "Search the Legal Shaman knowledge wiki for UK legal signposting — housing, employment, family, debt, and more. Not legal advice.",
};

type PageProps = {
  searchParams: Promise<{ q?: string }>;
};

export default async function AskTheShamanPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const initialQuery = (sp.q || "").trim();
  const index = getWikiIndex();
  const categories = listWikiCategories();
  const featured = listFeaturedWikiPages(6);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 md:py-12">
        <header className="mb-8 space-y-2">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-primary md:text-4xl">
            Ask the Shaman
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Search {index.meta.pageCount.toLocaleString("en-GB")} source-grounded wiki pages on UK
            legal topics — curated from Citizens Advice, Advicenow, Lawhive, and more. The Shaman
            points you toward useful information; this is not legal advice.
          </p>
        </header>

        <AskShamanSearch initialQuery={initialQuery} />

        {!initialQuery ? (
          <>
            <section className="mt-10">
              <h2 className="font-serif text-xl font-semibold text-foreground">Browse by category</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {categories.map(({ category, count }) => (
                  <Link
                    key={category}
                    href={`/ask-the-shaman?q=${encodeURIComponent(category.replace(/_/g, " "))}`}
                    className="rounded-xl border border-border/70 bg-card px-4 py-3 text-sm transition-colors hover:border-gold/40"
                  >
                    <span className="font-medium capitalize text-foreground">{category}</span>
                    <span className="ml-2 text-muted-foreground">{count} pages</span>
                  </Link>
                ))}
              </div>
            </section>

            <section className="mt-10">
              <h2 className="flex items-center gap-2 font-serif text-xl font-semibold text-foreground">
                <BookOpen className="h-5 w-5 text-gold" />
                Popular guidance
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {featured.map((page) => (
                  <Card key={page.id} className="border-border/70 hover:border-gold/30">
                    <CardContent className="p-4">
                      <p className="text-xs uppercase tracking-wide text-gold">{page.category}</p>
                      <Link
                        href={`/ask-the-shaman/wiki/${encodeURIComponent(page.id)}`}
                        className="mt-1 block font-medium text-foreground hover:text-primary"
                      >
                        {page.title}
                      </Link>
                      {page.summary ? (
                        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{page.summary}</p>
                      ) : null}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          </>
        ) : null}

        <p className="mt-12 text-xs leading-relaxed text-muted-foreground">
          Wiki last indexed:{" "}
          {index.meta.indexedAt
            ? new Date(index.meta.indexedAt).toLocaleString("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
              })
            : "unknown"}
          . Rebuild with <code className="rounded bg-muted px-1">npm run index:wiki</code> after updating
          the Obsidian wiki.
        </p>
      </main>
      <Footer />
    </div>
  );
}
