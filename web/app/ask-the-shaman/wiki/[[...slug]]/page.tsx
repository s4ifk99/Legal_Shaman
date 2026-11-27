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
import { extractWikiExtraSections, WIKI_EXTRA_HEADINGS, type WikiExtraSection } from "@/lib/wiki/extra-sections";
import { getWikiHub, wikiBreadcrumbs, WIKI_HUB_ROOT } from "@/lib/wiki/hubs";
import { WikiBreadcrumbs } from "@/components/wiki/wiki-breadcrumbs";
import { WikiHubView } from "@/components/wiki/wiki-hub-view";

function ExtraSection({ title, section }: { title: string; section: WikiExtraSection | null }) {
  if (!section) return null;
  return (
    <section>
      <h2 className="font-serif text-lg font-semibold">{title}</h2>
      {section.intro.map((para) => (
        <p key={para} className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {renderWikiInline(para)}
        </p>
      ))}
      {section.bullets.length ? (
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-foreground marker:text-gold">
          {section.bullets.map((item) => (
            <li key={item}>{renderWikiInline(item)}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

type PageProps = {
  params: Promise<{ slug?: string[] }>;
};

/** Accept both %2F-encoded single segments and real multi-segment paths. */
function wikiIdFromSlugParam(slug: string[] | undefined): string {
  if (!slug?.length) return "";
  return slug.map((part) => decodeURIComponent(part)).join("/");
}

/**
 * Page-level backup for legacy %2F wiki URLs.
 * Middleware also 308s these; keep this for cases where the catch-all still
 * receives a single encoded segment.
 */
function redirectEncodedSlashForm(slug: string[] | undefined, id: string, exists: boolean) {
  if (!exists || !id.includes("/")) return;
  if (slug?.length === 1) {
    permanentRedirect(wikiPagePublicPath(id));
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const id = wikiIdFromSlugParam(slug);
  if (!id) permanentRedirect(wikiPagePublicPath(WIKI_HUB_ROOT));
  const page = id ? getWikiPageById(id) : null;
  const hub = !page && id ? getWikiHub(id) : null;
  redirectEncodedSlashForm(slug, id, Boolean(page || hub));
  const canonical = id ? wikiPagePublicPath(id) : undefined;
  if (hub) {
    const isRoot = !hub.id.includes("/");
    return {
      title: isRoot ? "Legal guides by area" : `${hub.title}: who helps guides`,
      description: isRoot
        ? "Browse England and Wales signposting guides by area of law. Find who can help, not legal advice."
        : `England and Wales signposting guides for ${hub.title.toLowerCase()} problems: who can help, free advice routes and next steps. Not legal advice.`,
      alternates: canonical ? { canonical } : undefined,
      robots: hub.indexable ? { index: true, follow: true } : { index: false, follow: true },
    };
  }
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
  if (!id) permanentRedirect(wikiPagePublicPath(WIKI_HUB_ROOT));
  const page = id ? getWikiPageById(id) : null;
  const hub = !page && id ? getWikiHub(id) : null;
  redirectEncodedSlashForm(slug, id, Boolean(page || hub));
  if (hub) return <WikiHubView hub={hub} />;
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
  const extra = extractWikiExtraSections(page.content);

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

        <div className="mt-4">
          <WikiBreadcrumbs
            crumbs={wikiBreadcrumbs(page.id)}
            current={page.title}
            currentHref={wikiPagePublicPath(page.id)}
          />
        </div>

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

          <ExtraSection title={WIKI_EXTRA_HEADINGS.law} section={extra.law} />
          <ExtraSection title={WIKI_EXTRA_HEADINGS.howWeHelp} section={extra.howWeHelp} />

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

          {extra.nextStep ? (
            <Card className="border-gold/40">
              <CardContent className="p-5">
                <ExtraSection title={WIKI_EXTRA_HEADINGS.nextStep} section={extra.nextStep} />
              </CardContent>
            </Card>
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
          {extra.disclaimer ? (
            renderWikiInline(extra.disclaimer)
          ) : (
            <>
              This is signposting information from the Legal Shaman wiki, not legal advice. Always consult
              a qualified solicitor for your situation.
            </>
          )}
        </p>
      </main>
      <Footer />
    </div>
  );
}
