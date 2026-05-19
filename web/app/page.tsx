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
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-primary md:text-4xl lg:text-5xl">
            Legal Shaman
          </h1>
          <p className="mt-3 text-lg font-medium text-foreground md:text-xl">
            The Most Powerful Agentic Search Engine for All Your Disputes
          </p>
          <p className="mt-4 text-muted-foreground md:text-lg">
            Tell us your problem and we&apos;ll point you in the right direction — solicitors, legal aid, free advice, and more.
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            <a href="#find-help" className="text-primary underline-offset-4 hover:underline">
              Start your search
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
