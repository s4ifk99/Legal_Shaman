import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { ProblemAssistant } from "@/components/problem-assistant";
import { CategoryCards, type CategorySection } from "@/components/category-cards";
import { SpiralBackground } from "@/components/spiral-decoration";
import signpostingResources from "@/data/signposting-resources.json";
import Image from "next/image";

export default function Home() {
  const sections = signpostingResources.sections as CategorySection[];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      
      {/* Hero section with spiral decorations */}
      <section className="relative overflow-hidden border-b border-border bg-gradient-to-b from-background to-muted/30 py-12 md:py-16">
        <SpiralBackground />
        <div className="relative mx-auto max-w-4xl px-4 text-center">
          <div className="mb-6 flex justify-center">
            <div className="relative">
              <div className="absolute -inset-4 rounded-full bg-gradient-to-br from-primary/20 via-secondary/20 to-accent/20 blur-xl" />
              <Image
                src="/logo.jpg"
                alt="Legal Shaman Logo"
                width={140}
                height={140}
                className="relative h-32 w-32 rounded-full border-4 border-gold shadow-lg"
              />
            </div>
          </div>
          <h1 className="font-serif text-4xl font-bold tracking-tight text-foreground md:text-5xl lg:text-6xl">
            <span className="text-primary">Legal</span>{" "}
            <span className="text-secondary">Shaman</span>
          </h1>
          <p className="mt-4 text-lg font-medium text-foreground md:text-xl">
            The Most Powerful Agentic Search Engine for All Your Disputes
          </p>
          <p className="mt-3 text-muted-foreground md:text-lg">
            Tell us your problem and we&apos;ll point you in the right direction — solicitors, legal aid, free advice, and more.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <a
              href="#find-help"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-medium text-primary-foreground shadow-lg transition-all hover:scale-105 hover:shadow-xl"
            >
              Start Your Search
            </a>
            <a
              href="#categories"
              className="inline-flex items-center gap-2 rounded-full border-2 border-secondary bg-transparent px-6 py-3 font-medium text-secondary transition-all hover:bg-secondary hover:text-secondary-foreground"
            >
              Browse Categories
            </a>
          </div>
        </div>
      </section>

      {/* Category cards section - poker table style */}
      <section id="categories" className="relative py-12 md:py-16">
        <SpiralBackground className="opacity-50" />
        <div className="relative mx-auto max-w-6xl px-4">
          <div className="mb-10 text-center">
            <h2 className="font-serif text-3xl font-bold text-foreground md:text-4xl">
              Draw Your <span className="text-accent">Card</span>
            </h2>
            <p className="mt-3 text-muted-foreground md:text-lg">
              Choose a category to reveal helpful resources and guidance
            </p>
          </div>
          
          <CategoryCards sections={sections} />
        </div>
      </section>

      <main className="flex-1">
        <ProblemAssistant />
      </main>
      
      <Footer />
    </div>
  );
}
