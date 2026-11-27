import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { WikiBreadcrumbs } from "@/components/wiki/wiki-breadcrumbs";
import { formatGuideDate, listGuidesNewestFirst, type DatedWikiPage } from "@/lib/wiki/published";
import { wikiPagePublicPath } from "@/lib/wiki/public-url";

export const metadata: Metadata = {
  title: "Who helps: situation guides",
  description:
    "England and Wales signposting guides for common situations. Find who can help, newest first. Not legal advice.",
  alternates: { canonical: "/ask-the-shaman/who-helps" },
};

function areaIdOf(id: string): string {
  return id.split("/").slice(0, 2).join("/");
}

export default function WhoHelpsHubPage() {
  const guides = listGuidesNewestFirst();
  const latest = guides.slice(0, 12);

  const byArea = new Map<string, DatedWikiPage[]>();
  for (const guide of guides) {
    const area = areaIdOf(guide.id);
    const list = byArea.get(area) ?? [];
    list.push(guide);
    byArea.set(area, list);
  }
  const areas = [...byArea.entries()].sort((a, b) => a[0].localeCompare(b[0], "en-GB"));

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <WikiBreadcrumbs
          crumbs={[{ label: "Ask the Shaman", href: "/ask-the-shaman" }]}
          current="Who helps"
          currentHref="/ask-the-shaman/who-helps"
        />

        <header className="mt-6 space-y-2">
          <h1 className="font-serif text-3xl font-bold text-foreground">Who helps</h1>
          <p className="text-muted-foreground">
            Situation guides for England and Wales. Signposting only, not legal advice.{" "}
            <Link href="/ask-the-shaman/wiki/Areas" className="font-medium text-primary hover:underline">
              Browse by area
            </Link>
          </p>
        </header>

        <section className="mt-8">
          <h2 className="font-serif text-xl font-semibold text-foreground">Latest guides</h2>
          <ul className="mt-4 space-y-2">
            {latest.map((guide) => (
              <li key={guide.id} className="text-sm">
                <Link
                  href={wikiPagePublicPath(guide.id)}
                  className="font-medium text-foreground underline-offset-2 hover:text-primary hover:underline"
                >
                  {guide.title}
                </Link>
                {guide.publishedAt ? (
                  <time dateTime={guide.publishedAt} className="ml-2 text-xs text-muted-foreground">
                    {formatGuideDate(guide.publishedAt)}
                  </time>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        {areas.map(([areaId, list]) => (
          <section key={areaId} className="mt-10">
            <h2 className="font-serif text-xl font-semibold text-foreground">
              <Link href={wikiPagePublicPath(areaId)} className="hover:text-primary hover:underline">
                {areaId.split("/").pop()}
              </Link>
            </h2>
            <ul className="mt-4 space-y-3">
              {list.map((page) => (
                <li key={page.id}>
                  <Link
                    href={wikiPagePublicPath(page.id)}
                    className="block rounded-lg border border-border/60 px-4 py-3 transition-colors hover:border-gold/40"
                  >
                    <span className="text-xs uppercase tracking-wide text-gold">
                      {page.id.split("/").slice(-2, -1)[0]}
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
        ))}
      </main>
      <Footer />
    </div>
  );
}
