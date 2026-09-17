import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { SpiralBackground } from "@/components/spiral-decoration";
import { SignpostInstallPanel } from "@/components/signpost/signpost-install-panel";
import { SignpostWidget } from "@/components/signpost/signpost-widget";
import { ArrowRight, EyeOff, Share2, Shield } from "lucide-react";

export const metadata: Metadata = {
  title: "For firms",
  description:
    "Legal Shaman Signpost for UK law firms and advice agencies: overflow routing, a paste-ready widget, and SRA-grounded signposting. Not legal advice.",
  alternates: { canonical: "https://www.legalshaman.com/for-firms" },
};

const offers = [
  {
    icon: Share2,
    title: "Send overflow, keep the relationship",
    body: "When a matter is not yours, point the person to Signpost. We route free help and legal aid first, then SRA-verified firms — not a rival in your practice area on your widget.",
  },
  {
    icon: EyeOff,
    title: "Competitors stay hidden on your embed",
    body: "The iframe on your site does not parade direct competitors in your own area. You help the client access the law without handing them to the firm next door.",
  },
  {
    icon: Shield,
    title: "Signposting only",
    body: "We do not give legal advice, recommend a named solicitor as counsel, or assess a case. Matches come from stored register data. That is the compliance line every channel repeats.",
  },
];

export default function ForFirmsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <section className="relative overflow-hidden border-b-2 border-gold/30 bg-gradient-to-b from-background to-muted/30 py-12 md:py-16">
        <SpiralBackground />
        <div className="relative mx-auto max-w-4xl px-4">
          <p className="text-sm font-medium text-gold">For firms and advice agencies</p>
          <div className="mt-4 flex items-center gap-4">
            <div className="relative hidden sm:block">
              <div className="absolute -inset-2 rounded-full bg-gold/20 blur-md" />
              <Image
                src="/logo.jpg"
                alt=""
                width={56}
                height={56}
                className="relative h-14 w-14 rounded-full border-2 border-gold/50"
              />
            </div>
            <h1 className="font-serif text-3xl font-bold text-foreground md:text-4xl">
              Overflow routing for UK legal practices
            </h1>
          </div>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Paste Signpost on your site. When you cannot take a matter, the client still gets a
            next step — legal aid, free services, then the register — without you sending work to a
            direct competitor.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/embed/install"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Install the widget
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/signpost"
              className="inline-flex items-center gap-2 rounded-lg border border-gold/40 bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:border-gold"
            >
              See how Signpost works
            </Link>
          </div>
        </div>
      </section>

      <section className="relative py-12 md:py-16">
        <SpiralBackground className="opacity-30" />
        <div className="relative mx-auto max-w-4xl px-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">What you get</h2>
          <p className="mt-2 text-muted-foreground">
            One offer this quarter: the live Signpost embed. Not claimed listings, not sponsored
            matcher placement.
          </p>
          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            {offers.map((offer) => (
              <div
                key={offer.title}
                className="rounded-2xl border-2 border-gold/30 bg-card p-6 shadow-sm"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold/15">
                  <offer.icon className="h-5 w-5 text-gold" />
                </div>
                <h3 className="mt-4 font-serif text-lg font-bold text-foreground">{offer.title}</h3>
                <p className="mt-2 leading-relaxed text-muted-foreground">{offer.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative border-t-2 border-gold/30 py-12 md:py-16">
        <div className="relative mx-auto max-w-4xl px-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">Paste this iframe</h2>
          <p className="mt-2 text-muted-foreground">
            Same snippet as{" "}
            <Link href="/embed/install" className="text-primary underline">
              /embed/install
            </Link>
            . Height can be changed to fit your page.
          </p>
          <div className="mt-6 rounded-2xl border border-gold/30 bg-card p-6">
            <SignpostInstallPanel />
          </div>
        </div>
      </section>

      <section className="relative border-t-2 border-gold/30 bg-gradient-to-b from-muted/30 to-background py-12 md:py-16">
        <div className="relative mx-auto max-w-4xl px-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">Preview</h2>
          <p className="mt-2 text-muted-foreground">What visitors see inside the widget.</p>
          <div className="mt-8">
            <SignpostWidget variant="page" />
          </div>
          <p className="mt-10 text-sm text-muted-foreground">
            Questions:{" "}
            <a href="mailto:support@legalshaman.com" className="text-primary underline">
              support@legalshaman.com
            </a>{" "}
            or{" "}
            <a
              href="https://www.linkedin.com/in/aleemthedreamm/"
              className="text-primary underline"
            >
              LinkedIn
            </a>
            . Legal Shaman is not a law firm and does not provide legal advice.
          </p>
        </div>
      </section>

      <Footer />
    </div>
  );
}
