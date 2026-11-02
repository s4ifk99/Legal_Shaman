import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { listWhoHelpsWikiPages } from "@/lib/wiki/search";
import { wikiPagePublicPath } from "@/lib/wiki/public-url";
import { SITEMAP_PRIORITY_WIKI_IDS } from "@/lib/wiki/sitemap-priority";

export const metadata: Metadata = {
  title: "Who helps — situation guides",
  description:
    "England and Wales signposting guides for common situations — who can help, not legal advice.",
  alternates: { canonical: "/ask-the-shaman/who-helps" },
};

export default function WhoHelpsHubPage() {
  const pages = listWhoHelpsWikiPages(SITEMAP_PRIORITY_WIKI_IDS);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Link
          href="/ask-the-shaman"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Ask the Shaman
        </Link>

        <header className="mt-6 space-y-2">
          <h1 className="font-serif text-3xl font-bold text-foreground">Who helps</h1>
          <p className="text-muted-foreground">
            Situation guides for England and Wales. Signposting only — not legal advice.
          </p>
        </header>

        <ul className="mt-8 space-y-3">
          {pages.map((page) => (
            <li key={page.id}>
              <Link
                href={wikiPagePublicPath(page.id)}
                className="block rounded-lg border border-border/60 px-4 py-3 transition-colors hover:border-gold/40"
              >
                <span className="text-xs uppercase tracking-wide text-gold">{page.category}</span>
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
      </main>
      <Footer />
    </div>
  );
}
