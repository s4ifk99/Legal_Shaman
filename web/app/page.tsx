import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { ProblemAssistant } from "@/components/problem-assistant";
import signpostingResources from "@/data/signposting-resources.json";
import SignpostingView, { type Section } from "./signposting/signposting-view";

export default function Home() {
  const sections = signpostingResources.sections as Section[];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <section className="border-b border-border bg-background py-10 md:py-12">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-primary md:text-4xl">
            Legal Shaman
          </h1>
          <p className="mt-4 text-muted-foreground md:text-lg">
            Browse signposting resources on this page. When you&apos;re ready, scroll to the bottom to search the
            directory by topic, location, and filters.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            <a href="#find-help" className="text-primary underline-offset-4 hover:underline">
              Jump to directory search
            </a>
            {" · "}
            <a href="#signposting" className="text-primary underline-offset-4 hover:underline">
              Helplines and guides
            </a>
          </p>
        </div>
      </section>
      <main className="flex-1">
        <SignpostingView variant="embedded" sections={sections} />
      </main>
      <ProblemAssistant />
      <Footer />
    </div>
  );
}
