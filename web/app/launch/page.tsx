import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { PROBLEM_LANDINGS } from "@/lib/problems/catalog";

export const metadata: Metadata = {
  title: "Legal Shaman on Product Hunt",
  description:
    "Justice through search — understand your legal problem, discover options, take a next step. Signposting only, not legal advice.",
};

/** Thin Product Hunt / launch landing with tagged CTAs into necessity pages. */
export default function LaunchPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background" data-landing="producthunt">
      <Header />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-12 md:py-16">
        <p className="text-sm font-medium uppercase tracking-wide text-primary">Product Hunt</p>
        <h1 className="mt-3 font-serif text-4xl font-bold text-foreground">Legal Shaman</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Understand your legal problem. Discover free and funded options first. Take a useful next
          step — signposting only, not legal advice.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/ask-the-shaman?utm_source=producthunt&utm_medium=launch&utm_campaign=nov2026">
              Try Ask the Shaman
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/problems/housing?utm_source=producthunt&utm_medium=launch&utm_campaign=nov2026">
              Start with housing
            </Link>
          </Button>
        </div>
        <section className="mt-12">
          <h2 className="font-serif text-xl font-semibold">Or pick a problem</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {PROBLEM_LANDINGS.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/problems/${p.slug}?utm_source=producthunt&utm_medium=launch&utm_campaign=nov2026`}
                  className="block rounded-xl border border-border bg-card p-4 transition hover:border-primary/40"
                >
                  <span className="font-medium text-foreground">{p.title}</span>
                  <span className="mt-1 block text-sm text-muted-foreground line-clamp-2">
                    {p.summary}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <Footer />
    </div>
  );
}
