"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Footer } from "@/components/footer";
import { CategoryCards, type CategorySection } from "@/components/category-cards";
import { LegalShamanLogo } from "@/components/legal-shaman-logo";
import { RothkoField } from "@/components/v3/rothko-field";
import { TypewriterHeadline } from "@/components/v3/typewriter-headline";
import { captureProductEvent } from "@/components/analytics/posthog-provider";
import { JOURNEY_EVENTS } from "@/lib/analytics/journey-events";

type Props = {
  sections: CategorySection[];
  /** Server rendered block (Latest guides) shown below the directory. */
  latest?: ReactNode;
};

/**
 * Local landing: Rothko backdrop, no site header / old search bar —
 * primary CTA launches Ask the Shaman.
 */
export function LandingShell({ sections, latest }: Props) {
  const [pulseKey, setPulseKey] = useState(0);

  useEffect(() => {
    captureProductEvent(JOURNEY_EVENTS.landingViewed, { path: "/" });
  }, []);

  useEffect(() => {
    // Gentle colour field shifts while browsing the landing.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setPulseKey(1);
      return;
    }
    setPulseKey(1);
    const id = window.setInterval(() => {
      setPulseKey((n) => n + 1);
    }, 4200);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="relative flex min-h-dvh flex-col bg-transparent">
      <RothkoField pulseKey={pulseKey} highlightMessages highlightInput />

      <main className="relative z-10 flex flex-1 flex-col">
        <div className="relative flex justify-center px-4 pt-6 md:pt-8">
          <Link href="/" className="inline-flex" aria-label="Legal Shaman home">
            <LegalShamanLogo
              className="h-auto w-[min(36rem,88vw)] drop-shadow-sm"
              priority
            />
          </Link>
        </div>

        <section className="relative border-b border-white/25 py-10 md:py-16">
          <div className="relative mx-auto max-w-6xl px-4">
            <div className="mx-auto max-w-3xl rounded-[1.75rem] border border-white/35 bg-background/25 px-6 py-10 text-center shadow-[0_12px_40px_rgba(20,30,20,0.12)] backdrop-blur-[2px] md:px-10 md:py-12">
              <TypewriterHeadline className="min-h-[4.5rem] font-serif text-3xl font-bold text-foreground drop-shadow-sm md:min-h-[6rem] md:text-5xl" />
              <div className="mt-8 flex justify-center">
                <Link
                  href="/ask-the-shaman"
                  onClick={() =>
                    captureProductEvent(JOURNEY_EVENTS.landingCtaAsk, {
                      path: "/",
                      cta: "hero",
                    })
                  }
                  className="inline-flex min-w-[14rem] items-center justify-center rounded-xl bg-primary px-10 py-4 text-lg font-semibold text-primary-foreground shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-lg"
                >
                  Ask the Shaman
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="relative border-b border-white/25 py-12 md:py-16">
          <div className="relative mx-auto max-w-4xl px-4">
            <div className="mb-10 text-center">
              <h2 className="font-serif text-3xl font-bold text-foreground drop-shadow-sm md:text-4xl">
                What is <span className="text-primary">Legal Shaman</span>?
              </h2>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:gap-8">
              {[
                {
                  title: "The Shaman points you in the right direction.",
                  body: "Our intelligent agent understands your legal situation and recommends solicitors, legal aid providers, and free resources tailored to your needs.",
                },
                {
                  title: "Get a second, third, or tenth opinion.",
                  body: "Whether you face housing disputes, employment conflicts, family matters, or debt issues, we encourage you to speak to as many lawyers and advisers as possible.",
                },
                {
                  title: "Free services first.",
                  body: "Find free legal advice, pro bono services, and legal aid options. We simplify search to help you find justice regardless of your financial situation.",
                },
                {
                  title: "Answers in seconds, not hours.",
                  body: "No more endless searching. Tell us your problem and get personalised directory matches in seconds.",
                },
              ].map((card) => (
                <div
                  key={card.title}
                  className="rounded-xl border border-white/40 bg-background/35 p-6 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-background/50 md:p-8"
                >
                  <h3 className="font-serif text-lg font-semibold text-foreground">{card.title}</h3>
                  <p className="mt-3 text-foreground/80">{card.body}</p>
                </div>
              ))}
            </div>

            <div className="mt-10 text-center">
              <Link
                href="/ask-the-shaman"
                onClick={() =>
                  captureProductEvent(JOURNEY_EVENTS.landingCtaAsk, {
                    path: "/",
                    cta: "what_is",
                  })
                }
                className="inline-flex items-center justify-center rounded-xl bg-primary px-8 py-3.5 text-base font-semibold text-primary-foreground shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-lg"
              >
                Start with Ask the Shaman
              </Link>
            </div>
          </div>
        </section>

        <section id="categories" className="relative py-12 md:py-16">
          <div className="relative mx-auto max-w-6xl px-4">
            <div className="mb-10 text-center">
              <h2 className="font-serif text-3xl font-bold text-foreground drop-shadow-sm md:text-4xl">
                Directory by area
              </h2>
              <p className="mt-3 text-foreground/80 md:text-lg">
                Free Services, first, always
              </p>
            </div>

            <div className="rounded-[1.5rem] border border-white/30 bg-background/20 p-4 backdrop-blur-[2px] md:p-6">
              <CategoryCards sections={sections} />
            </div>

            <div className="mt-10 text-center">
              <Link
                href="/blog"
                onClick={() =>
                  captureProductEvent(JOURNEY_EVENTS.landingDirectoryClick, {
                    path: "/",
                    target: "/blog",
                  })
                }
                className="inline-flex items-center rounded-xl border-2 border-white/40 bg-background/35 px-6 py-3 text-sm font-medium text-foreground backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-background/55"
              >
                Read the Blog
              </Link>
            </div>
          </div>
        </section>

        {latest}
      </main>

      <div className="relative z-10">
        <Footer />
      </div>
    </div>
  );
}
