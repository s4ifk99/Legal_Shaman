import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { ProblemLandingTracker } from "@/components/problems/problem-landing-tracker";
import { PROBLEM_LANDINGS, problemBySlug } from "@/lib/problems/catalog";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return PROBLEM_LANDINGS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const problem = problemBySlug(slug);
  if (!problem) return { title: "Legal problem help" };
  return {
    title: `${problem.title} | Legal Shaman`,
    description: problem.summary,
  };
}

export default async function ProblemLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const problem = problemBySlug(slug);
  if (!problem) notFound();

  const searchHref = `/search?q=${encodeURIComponent(problem.searchQuery)}&landing=${encodeURIComponent(problem.slug)}`;
  const askHref = `/ask-the-shaman?guided=1&landing=${encodeURIComponent(problem.slug)}&q=${encodeURIComponent(problem.askHint)}`;

  return (
    <div className="flex min-h-screen flex-col bg-background" data-landing={problem.slug}>
      <Header />
      <ProblemLandingTracker slug={problem.slug} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-12 md:py-16">
        <p className="text-sm font-medium uppercase tracking-wide text-primary">
          Specific legal need
        </p>
        <h1 className="mt-3 font-serif text-3xl font-bold text-foreground md:text-4xl">
          {problem.headline}
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">{problem.summary}</p>
        <ul className="mt-8 space-y-2 text-sm text-foreground">
          {problem.bullets.map((b) => (
            <li key={b} className="flex gap-2">
              <span className="text-primary" aria-hidden>
                ·
              </span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <div className="mt-10 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href={askHref}>Ask the Shaman</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={searchHref}>Search providers</Link>
          </Button>
          <Button asChild variant="ghost" size="lg">
            <Link href="/?landing=general">General search home</Link>
          </Button>
        </div>
        <p className="mt-8 text-xs text-muted-foreground">
          Signposting only — Legal Shaman is not a solicitor and does not give legal advice.
        </p>
      </main>
      <Footer />
    </div>
  );
}
