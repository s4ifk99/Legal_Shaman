import Link from "next/link";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { WikiBreadcrumbs } from "@/components/wiki/wiki-breadcrumbs";
import { formatGuideDate } from "@/lib/wiki/published";
import { wikiBreadcrumbs, type WikiHub } from "@/lib/wiki/hubs";
import { wikiPagePublicPath } from "@/lib/wiki/public-url";

export function WikiHubView({ hub }: { hub: WikiHub }) {
  const isRoot = !hub.id.includes("/");
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <WikiBreadcrumbs
          crumbs={wikiBreadcrumbs(hub.id)}
          current={hub.title}
          currentHref={wikiPagePublicPath(hub.id)}
        />

        <header className="mt-6 space-y-2">
          <h1 className="font-serif text-3xl font-bold text-foreground">
            {isRoot ? "Legal guides by area" : `${hub.title}: who helps guides`}
          </h1>
          <p className="text-muted-foreground">
            Situation guides for England and Wales showing who can help. Signposting only, not legal
            advice.
          </p>
        </header>

        {hub.guides.length ? (
          <section className="mt-8">
            <h2 className="font-serif text-xl font-semibold text-foreground">
              {isRoot ? "Newest guides" : `Who helps guides in ${hub.title}`}
            </h2>
            <ul className="mt-4 space-y-3">
              {(isRoot ? hub.guides.slice(0, 12) : hub.guides).map((guide) => (
                <li key={guide.id}>
                  <Link
                    href={wikiPagePublicPath(guide.id)}
                    className="block rounded-lg border border-border/60 px-4 py-3 transition-colors hover:border-gold/40"
                  >
                    <span className="block font-medium text-foreground">{guide.title}</span>
                    {guide.summary ? (
                      <span className="mt-1 block line-clamp-2 text-sm text-muted-foreground">
                        {guide.summary.replace(/\*\*/g, "")}
                      </span>
                    ) : null}
                    {guide.publishedAt ? (
                      <time dateTime={guide.publishedAt} className="mt-1 block text-xs text-muted-foreground">
                        {formatGuideDate(guide.publishedAt)}
                      </time>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {hub.children.length ? (
          <section className="mt-10">
            <h2 className="font-serif text-xl font-semibold text-foreground">
              {isRoot ? "Areas" : "Topics in this area"}
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {hub.children.map((child) => (
                <li key={child.id}>
                  <Link
                    href={child.href}
                    className="block rounded-lg border border-border/60 px-4 py-3 text-sm transition-colors hover:border-gold/40"
                  >
                    <span className="font-medium text-foreground">{child.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {child.guideCount
                        ? `${child.guideCount} who helps ${child.guideCount === 1 ? "guide" : "guides"}`
                        : `${child.pageCount} ${child.pageCount === 1 ? "page" : "pages"}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {hub.otherPages.length ? (
          <section className="mt-10">
            <h2 className="font-serif text-xl font-semibold text-foreground">More guidance</h2>
            <ul className="mt-4 space-y-2 text-sm">
              {hub.otherPages.map((page) => (
                <li key={page.id}>
                  <Link
                    href={wikiPagePublicPath(page.id)}
                    className="text-foreground underline-offset-2 hover:text-primary hover:underline"
                  >
                    {page.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="mt-10 text-sm">
          <Link href="/ask-the-shaman/who-helps" className="font-medium text-primary hover:underline">
            See all who helps guides
          </Link>
        </p>
        <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
          This is signposting information from Legal Shaman, not legal advice. Always speak to a
          qualified adviser or solicitor about your situation.
        </p>
      </main>
      <Footer />
    </div>
  );
}
