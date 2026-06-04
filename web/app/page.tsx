import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { WaitlistSignup } from "@/components/waitlist-signup";
import { SpiralBackground } from "@/components/spiral-decoration";
import Image from "next/image";

export default function Home() {
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
            Coming Soon — Launching Your Legal AI Assistant
          </p>
        </div>
      </section>

      {/* Features section explaining the agentic search engine */}
      <section className="relative py-12 md:py-16 border-b border-border">
        <SpiralBackground className="opacity-50" />
        <div className="relative mx-auto max-w-4xl px-4">
          <div className="text-center mb-10">
            <h2 className="font-serif text-3xl font-bold text-foreground md:text-4xl">
              What Is <span className="text-accent">Legal Shaman</span>?
            </h2>
          </div>
          
          <div className="grid gap-6 md:grid-cols-2 lg:gap-8">
            {/* Feature 1 */}
            <div className="rounded-xl border-2 border-gold/30 bg-card p-6 md:p-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/20">
                <span className="text-2xl">🤖</span>
              </div>
              <h3 className="font-serif text-lg font-semibold text-foreground">
                Agentic AI Assistant
              </h3>
              <p className="mt-3 text-muted-foreground">
                Our intelligent agent understands your legal situation and intelligently recommends the best solicitors, legal aid providers, and free resources tailored to your needs.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="rounded-xl border-2 border-gold/30 bg-card p-6 md:p-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-secondary/20">
                <span className="text-2xl">🎯</span>
              </div>
              <h3 className="font-serif text-lg font-semibold text-foreground">
                Dispute Resolution
              </h3>
              <p className="mt-3 text-muted-foreground">
                Whether you face housing disputes, employment conflicts, family matters, or debt issues, Legal Shaman points you to the right direction instantly.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="rounded-xl border-2 border-gold/30 bg-card p-6 md:p-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-accent/20">
                <span className="text-2xl">💰</span>
              </div>
              <h3 className="font-serif text-lg font-semibold text-foreground">
                Affordable & Accessible
              </h3>
              <p className="mt-3 text-muted-foreground">
                Find free legal advice, pro bono services, and legal aid options. We help you access justice regardless of your financial situation.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="rounded-xl border-2 border-gold/30 bg-card p-6 md:p-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/20">
                <span className="text-2xl">⚡</span>
              </div>
              <h3 className="font-serif text-lg font-semibold text-foreground">
                Instant Guidance
              </h3>
              <p className="mt-3 text-muted-foreground">
                No more endless searching. Simply tell us your problem and get personalized recommendations in seconds.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Waitlist CTA section */}
      <section id="waitlist" className="relative overflow-hidden border-t-2 border-gold/30 bg-gradient-to-br from-primary/5 via-background to-secondary/5 py-12 md:py-16">
        <SpiralBackground className="opacity-30" />
        <div className="relative mx-auto max-w-3xl px-4">
          <div className="text-center mb-10">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-accent/20 px-4 py-2 text-sm font-medium text-accent-foreground">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
              </span>
              <span>Coming Soon</span>
            </div>
            <h2 className="font-serif text-3xl font-bold text-foreground md:text-4xl">
              Be the First to Know
            </h2>
            <p className="mt-3 text-muted-foreground md:text-lg">
              Join our waitlist to be notified the moment Legal Shaman officially launches. Get exclusive early access and help shape the future of legal assistance.
            </p>
          </div>

          <div className="rounded-2xl border-2 border-gold/30 bg-card p-6 shadow-xl md:p-8">
            <WaitlistSignup />
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <div className="text-center">
              <p className="text-3xl font-bold text-primary">Legal</p>
              <p className="mt-1 text-sm text-muted-foreground">AI-Powered</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-secondary">Smart</p>
              <p className="mt-1 text-sm text-muted-foreground">Agentic Matching</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-accent">Fast</p>
              <p className="mt-1 text-sm text-muted-foreground">Instant Results</p>
            </div>
          </div>
        </div>
      </section>
      
      <Footer />
    </div>
  );
}
