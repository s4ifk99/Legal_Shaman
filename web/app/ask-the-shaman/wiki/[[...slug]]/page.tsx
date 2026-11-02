import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Card, CardContent } from "@/components/ui/card";
import { getWikiPageById, listSiblingWikiPages, resolveWikiConcept } from "@/lib/wiki/search";
import { renderWikiInline } from "@/lib/wiki/render-inline";
import { wikiPagePublicPath } from "@/lib/wiki/public-url";
import { stripRawSourcePath } from "@/lib/wiki/source-line";

type PageProps = {
  params: Promise<{ slug?: string[] }>;
};

/** Accept both %2F-encoded single segments and real multi-segment paths. */
function wikiIdFromSlugParam(slug: string[] | undefined): string {
  if (!slug?.length) return "";
  return slug.map((part) => decodeURIComponent(part)).join("/");
}

function redirectEncodedSlashForm(slug: string[] | undefined, id: string, exists: boolean) {
  if (exists && slug?.length === 1 && id.includes("/")) {
    permanentRedirect(wikiPagePublicPath(id));
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const id = wikiIdFromSlugParam(slug);
  const page = id ? getWikiPageById(id) : null;
  redirectEncodedSlashForm(slug, id, Boolean(page));
  const canonical = id ? wikiPagePublicPath(id) : undefined;
  return {
    title: page?.title ?? "Wiki article",
    description: page?.summary
      ? page.summary.replace(/\*\*/g, "").replace(/\s+/g, " ").trim()
      : undefined,
    alternates: canonical ? { canonical } : undefined,
    robots: page ? { index: true, follow: true } : { index: false, follow: false },
  };
}

export default async function WikiArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const id = wikiIdFromSlugParam(slug);
  const page = id ? getWikiPageById(id) : null;
  redirectEncodedSlashForm(slug, id, Boolean(page));
  if (!page) notFound();
  const related = page.relatedConcepts.slice(0, 12).map((concept) => ({
    concept,
    label: concept.replace(/^\[\[|\]\]$/g, ""),
    match: resolveWikiConcept(concept),
  }));
  const linkedIds = new Set(
    related.flatMap((item) => (item.match && item.match.id !== page.id ? [item.match.id] : [])),
  );
  const siblings = listSiblingWikiPages(page.id, 8).filter((item) => !linkedIds.has(item.id)).slice(0, 5);

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

        <header className="mt-6">
          <p className="text-xs font-medium uppercase tracking-wide text-gold">{page.category}</p>
          <h1 className="mt-2 font-serif text-3xl font-bold text-foreground">{page.title}</h1>
        </header>

        <div className="mt-8 space-y-6">
          {page.summary ? (
            <section>
              <h2 className="font-serif text-lg font-semibold">Summary</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {renderWikiInline(page.summary)}
              </p>
            </section>
          ) : null}

          {page.keyInformation.length ? (
            <section>
              <h2 className="font-serif text-lg font-semibold">Key information</h2>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-foreground marker:text-gold">
                {page.keyInformation.map((item) => (
                  <li key={item}>{renderWikiInline(item)}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {page.practicalGuidance.length ? (
            <section>
              <h2 className="font-serif text-lg font-semibold">Practical guidance</h2>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-foreground marker:text-gold">
                {page.practicalGuidance.map((item) => (
                  <li key={item}>{renderWikiInline(item)}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {related.length ? (
            <section>
              <h2 className="font-serif text-lg font-semibold">Related topics</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {related.map(({ concept, label, match }) => {
                  const className =
                    "rounded-full border border-border bg-muted px-3 py-1 text-xs text-foreground hover:border-gold/40";
                  if (!match || match.id === page.id) {
                    return (
                      <span key={concept} className={className}>
                        {label}
                      </span>
                    );
                  }
                  return (
                    <Link key={concept} href={wikiPagePublicPath(match.id)} className={className}>
                      {label}
                    </Link>
                  );
                })}
              </div>
            </section>
          ) : null}

          {siblings.length ? (
            <section>
              <h2 className="font-serif text-lg font-semibold">More in this area</h2>
              <ul className="mt-2 space-y-2 text-sm">
                {siblings.map((sibling) => (
                  <li key={sibling.id}>
                    <Link
                      href={wikiPagePublicPath(sibling.id)}
                      className="text-foreground underline-offset-2 hover:text-primary hover:underline"
                    >
                      {sibling.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {page.sources.length ? (
            <Card className="border-gold/20">
              <CardContent className="p-5">
                <h2 className="font-serif text-lg font-semibold">Sources</h2>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-xs text-muted-foreground marker:text-gold">
                  {page.sources.slice(0, 10).map((source) => (
                    <li key={source}>{renderWikiInline(stripRawSourcePath(source))}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <p className="mt-10 text-xs leading-relaxed text-muted-foreground">
          This is signposting information from the Legal Shaman wiki, not legal advice. Always consult
          a qualified solicitor for your situation.
        </p>
      </main>
      <Footer />
    </div>
  );
}
