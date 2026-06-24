import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { CategoryCards, type CategorySection } from "@/components/category-cards";
import { OslawTrendingMarquee } from "@/components/oslaw/trending-marquee";
import { ProductEntryCards } from "@/components/product-entry-cards";
import { SearchBar } from "@/components/search-bar";
import { SpiralBackground } from "@/components/spiral-decoration";
import signpostingResources from "@/data/signposting-resources.json";
import Image from "next/image";
import Link from "next/link";

export default function Home() {
  const sections = signpostingResources.sections as CategorySection[];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <OslawTrendingMarquee />

      <SearchBar compact />

      <section className="relative border-b border-border py-12 md:py-16">
        <SpiralBackground className="opacity-40" />
        <div className="relative mx-auto max-w-6xl px-4">
          <div className="mb-8 text-center">
            <h2 className="font-serif text-3xl font-bold text-foreground md:text-4xl">
              How can we help?
            </h2>
            <p className="mt-3 max-w-2xl mx-auto text-muted-foreground md:text-lg">
              Search the UK legal directory, get guided lawyer matches, read the wiki, or explore what people are discussing online.
            </p>
          </div>
          <ProductEntryCards />
        </div>
      </section>

      <section className="relative py-12 md:py-16 border-b border-border">
        <SpiralBackground className="opacity-50" />
        <div className="relative mx-auto max-w-4xl px-4">
          <div className="text-center mb-10">
            <h2 className="font-serif text-3xl font-bold text-foreground md:text-4xl">
              What is <span className="text-primary">Legal Shaman</span>?
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:gap-8">
            <div className="rounded-xl border-2 border-gold/30 bg-card p-6 md:p-8 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/20">
                <span className="text-2xl">🤖</span>
              </div>
              <h3 className="font-serif text-lg font-semibold text-foreground">
                The Shaman points you in the right direction.
              </h3>
              <p className="mt-3 text-muted-foreground">
                Our intelligent agent understands your legal situation and recommends solicitors, legal aid providers, and free resources tailored to your needs.
              </p>
            </div>

            <div className="rounded-xl border-2 border-gold/30 bg-card p-6 md:p-8 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-secondary/20">
                <span className="text-2xl">🎯</span>
              </div>
              <h3 className="font-serif text-lg font-semibold text-foreground">
                Get a second, third, or tenth opinion.
              </h3>
              <p className="mt-3 text-muted-foreground">
                Whether you face housing disputes, employment conflicts, family matters, or debt issues, we encourage you to speak to as many lawyers and advisers as possible.
              </p>
            </div>

            <div className="rounded-xl border-2 border-gold/30 bg-card p-6 md:p-8 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-accent/20">
                <span className="text-2xl">💰</span>
              </div>
              <h3 className="font-serif text-lg font-semibold text-foreground">
                Free services first.
              </h3>
              <p className="mt-3 text-muted-foreground">
                Find free legal advice, pro bono services, and legal aid options. We simplify search to help you find justice regardless of your financial situation.
              </p>
            </div>

            <div className="rounded-xl border-2 border-gold/30 bg-card p-6 md:p-8 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/20">
                <span className="text-2xl">⚡</span>
              </div>
              <h3 className="font-serif text-lg font-semibold text-foreground">
                Answers in seconds, not hours.
              </h3>
              <p className="mt-3 text-muted-foreground">
                No more endless searching. Tell us your problem and get personalised signposting in seconds.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="categories" className="relative py-12 md:py-16">
        <SpiralBackground className="opacity-50" />
        <div className="relative mx-auto max-w-6xl px-4">
          <div className="mb-10 text-center">
            <h2 className="font-serif text-3xl font-bold text-foreground md:text-4xl">
              Browse by <span className="text-primary">category</span>
            </h2>
            <p className="mt-3 text-muted-foreground md:text-lg">
              Click to reveal useful contacts and start your search
            </p>
          </div>

          <CategoryCards sections={sections} />

          <div className="mt-10 text-center">
            <Link
              href="/signposting"
              className="inline-flex items-center rounded-xl border-2 border-primary/30 bg-primary/5 px-6 py-3 text-sm font-medium text-primary transition-all duration-200 hover:-translate-y-0.5 hover:border-primary hover:bg-primary/10 hover:shadow-md"
            >
              View full signposting resources →
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
