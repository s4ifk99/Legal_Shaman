import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { headers } from "next/headers";
import { BookOpen } from "lucide-react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { AskShamanSearch } from "@/components/wiki/ask-shaman-search";
import { LawyerSearchClient } from "@/app/find-a-lawyer/lawyer-search-client";
import { Card, CardContent } from "@/components/ui/card";
import { CoherenceAskShell } from "@/components/coherence/CoherenceAskShell";
import { resolveCoherenceUi } from "@/lib/coherence/mode";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { getWikiIndex } from "@/lib/wiki/load-index";
import { listFeaturedWikiPages, listWikiCategories } from "@/lib/wiki/search";
import { enableMapSearch, enableSearchDebug } from "@/lib/legal-search/config";

export const metadata: Metadata = {
  title: "Ask the Shaman | Legal Shaman",
  description:
    "One search across wiki guidance, lawyer directory, and OSLAW — UK legal signposting in one place. Not legal advice.",
};

type PageProps = {
  searchParams: Promise<{
    q?: string;
    guided?: string;
    location?: string;
    classic?: string;
  }>;
};

function WikiBrowseSections() {
  const index = getWikiIndex();
  const categories = listWikiCategories();
  const featured = listFeaturedWikiPages(6);

  return (
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

      <p className="mt-10 text-xs leading-relaxed text-muted-foreground">
        Wiki indexed:{" "}
        {index.meta.indexedAt
          ? new Date(index.meta.indexedAt).toLocaleString("en-GB", {
              dateStyle: "medium",
              timeStyle: "short",
            })
          : "unknown"}
        {" · "}
        {index.meta.pageCount.toLocaleString("en-GB")} pages
      </p>
    </>
  );
}

export default async function AskTheShamanPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const initialQuery = (sp.q || "").trim();
  const initialLocation = (sp.location || "").trim();
  const showGuided = sp.guided === "1";
  const forceClassic = sp.classic === "1";

  const hdrs = await headers();
  const user = await getCurrentUser();
  const uiMode = await resolveCoherenceUi(hdrs.get("cookie"), user);

  // Coherence intake — local dev or feature-flagged V2 on Vercel.
  // Escape hatches: ?classic=1 (classic Ask), ?guided=1 (solicitor matching wizard).
  if (uiMode === "coherence" && !forceClassic && !showGuided) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <Header />
        <CoherenceAskShell initialStory={initialQuery} />
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:py-12">
        <header className="mb-8 space-y-2">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-primary md:text-4xl">
            Ask the Shaman
          </h1>
          <p className="max-w-3xl text-muted-foreground">
            One search for wiki guidance, lawyer matching, and live legal discussions — signposting
            only, not legal advice.
          </p>
          {uiMode === "coherence" && forceClassic ? (
            <p className="text-sm text-muted-foreground">
              Classic Ask (local escape hatch).{" "}
              <Link href="/ask-the-shaman" className="font-medium text-primary hover:underline">
                Back to Coherence intake
              </Link>
            </p>
          ) : null}
        </header>

        <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
          {showGuided ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Answer a few questions about your issue, funding, and location. We&apos;ll signpost
                you to legal aid, free help, and private providers.
              </p>
              <LawyerSearchClient
                mapEnabled={enableMapSearch()}
                debugEnabled={enableSearchDebug()}
              />
              <p className="text-sm text-muted-foreground">
                <Link href="/ask-the-shaman" className="font-medium text-primary hover:underline">
                  ← Back to unified search
                </Link>
              </p>
            </div>
          ) : (
            <>
              <AskShamanSearch initialQuery={initialQuery} initialLocation={initialLocation} />
              {!initialQuery ? <WikiBrowseSections /> : null}
            </>
          )}
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
