import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bookmark, BookOpen } from "lucide-react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { SearchBar } from "@/components/search-bar";
import { SpiralBackground } from "@/components/spiral-decoration";
import { DirectorySearchResults } from "@/components/search/directory-search-results";
import { SearchFormWithSuggestions } from "@/components/search-form-with-suggestions";
import { SearchDirectorySidebar } from "@/components/search-directory-sidebar";
import { OslawTrendingMarquee } from "@/components/oslaw/trending-marquee";
import { runDirectorySearch } from "@/lib/legal-search/run-directory-search";
import type { LegacyGetRow } from "@/lib/legal-search/legacy-get-response";
import { getDistinctCities, getListingsBySubcategory } from "@/lib/data";
import { enableMapSearch } from "@/lib/legal-search/config";
import { buildMapMarkers } from "@/lib/search/map-results";
import type { ResultDebugDiagnostics } from "@/lib/legal-search/search-diagnostics-types";

// Render on demand (like /search). Avoids a build-time database dependency and
// keeps directory results fresh as the underlying data updates.
export const dynamic = "force-dynamic";

type Combo = {
  areaLabel: string; // H1 / title fragment, e.g. "Divorce & Family Law Solicitors"
  areaShort: string; // lowercase for prose, e.g. "family law"
  practiceAreaSlug: string; // taxonomy slug passed to search
  locationLabel: string; // e.g. "London"
  query: string; // free-text query for the directory search
  intro: string; // unique intro copy (avoids thin/duplicate content)
  faqs: { q: string; a: string }[];
};

// Whitelist of the 3 highest-intent combos (Day-1 marketing plan). Only real,
// high-inventory combos get a page so we never ship thin/duplicate content.
const COMBOS: Record<string, Combo> = {
  "family/london": {
    areaLabel: "Divorce & Family Law Solicitors",
    areaShort: "family law",
    practiceAreaSlug: "family",
    locationLabel: "London",
    query: "divorce family law solicitor London",
    intro:
      "Looking for a family law solicitor in London? Whether you're facing divorce, dividing finances, or agreeing child arrangements, the listings below cover regulated firms and free or legal-aid help across Greater London. Start with a shortlist, then use the guided matcher to find the right fit for your situation.",
    faqs: [
      {
        q: "How much does a divorce solicitor in London cost?",
        a: "Fees vary widely — some offer fixed-fee consultations, others charge hourly. Many firms in the directory show whether they offer free or fixed-fee first consultations, and legal-aid providers are marked where available.",
      },
      {
        q: "Can I get legal aid for family matters in London?",
        a: "Legal aid for family cases is limited but available in some circumstances (for example where there is evidence of domestic abuse). Listings marked \u201cLegal Aid\u201d are GOV.UK-registered providers you can check your eligibility with.",
      },
      {
        q: "Is Legal Shaman a law firm?",
        a: "No. Legal Shaman helps you find and compare regulated solicitors and free help. This is not legal advice.",
      },
    ],
  },
  "immigration/london": {
    areaLabel: "Immigration Solicitors",
    areaShort: "immigration law",
    practiceAreaSlug: "immigration",
    locationLabel: "London",
    query: "immigration solicitor London spouse visa ILR asylum",
    intro:
      "Find immigration solicitors in London for spouse and family visas, indefinite leave to remain, Skilled Worker applications, and asylum or appeals. The listings below include SRA-verified firms and free or legal-aid immigration advice across the capital.",
    faqs: [
      {
        q: "What can an immigration solicitor in London help with?",
        a: "Common areas include spouse/partner visas, ILR, Skilled Worker and sponsorship, citizenship, and appeals to the First-tier Tribunal. Filter the listings by what you need.",
      },
      {
        q: "How do I check a firm is regulated?",
        a: "Immigration advice must be provided by regulated advisers. SRA-verified firms in the directory link to their official SRA profile so you can confirm their status.",
      },
      {
        q: "Is this legal advice?",
        a: "No. Legal Shaman signposts you to regulated help and free services. It does not provide legal advice.",
      },
    ],
  },
  "employment/manchester": {
    areaLabel: "Employment Solicitors",
    areaShort: "employment law",
    practiceAreaSlug: "employment",
    locationLabel: "Manchester",
    query: "employment solicitor unfair dismissal Manchester",
    intro:
      "Facing an issue at work in Manchester? These employment law listings cover unfair dismissal, redundancy, discrimination, and settlement agreements — including regulated firms and free or legal-aid advice across Greater Manchester. Many tribunal deadlines are short (often three months), so it's worth acting early.",
    faqs: [
      {
        q: "How long do I have to bring an employment tribunal claim?",
        a: "Most claims (such as unfair dismissal) must start Acas early conciliation within three months less one day of the event. Speak to a solicitor or adviser quickly to protect your deadline.",
      },
      {
        q: "Do employment solicitors in Manchester offer no-win-no-fee?",
        a: "Some do, and some offer free or fixed-fee first consultations. Listings indicate free and legal-aid options where available.",
      },
      {
        q: "Is Legal Shaman a substitute for legal advice?",
        a: "No. It helps you find regulated solicitors and free help near you. This is not legal advice.",
      },
    ],
  },
};

type PageProps = {
  params: Promise<{ practiceArea: string; location: string }>;
};

function comboKey(practiceArea: string, location: string): string {
  return `${practiceArea.toLowerCase()}/${location.toLowerCase()}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { practiceArea, location } = await params;
  const combo = COMBOS[comboKey(practiceArea, location)];
  if (!combo) {
    return { title: "Solicitors" };
  }
  const title = `${combo.areaLabel} in ${combo.locationLabel}`;
  const description = `Find ${combo.areaShort} solicitors in ${combo.locationLabel} — compare SRA-verified firms, legal aid providers, and free advice. Not legal advice.`;
  const canonical = `/solicitors/${practiceArea.toLowerCase()}/${location.toLowerCase()}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title: `${title} | Legal Shaman`, description, url: canonical },
  };
}

export default async function SolicitorsLandingPage({ params }: PageProps) {
  const { practiceArea, location } = await params;
  const combo = COMBOS[comboKey(practiceArea, location)];
  if (!combo) {
    notFound();
  }

  let rows: LegacyGetRow[] = [];
  let explanations: string[] = [];
  let debugByIndex: (ResultDebugDiagnostics | undefined)[] = [];
  let parsedPracticeArea: string | undefined = combo.practiceAreaSlug;
  let parsedLocation: string | undefined = combo.locationLabel;
  let markers: ReturnType<typeof buildMapMarkers>["markers"] = [];
  let missingCoordinatesCount = 0;

  try {
    const dir = await runDirectorySearch({
      query: combo.query,
      limit: 60,
      semantic: false,
      city: combo.locationLabel,
      practiceArea: combo.practiceAreaSlug,
    });
    rows = dir.legacyRows as LegacyGetRow[];
    explanations = dir.results.map((r) => r.explanation ?? "");
    debugByIndex = dir.results.map((r) => r.debug);
    parsedPracticeArea = dir.parsedQuery?.practiceAreaSlug ?? combo.practiceAreaSlug;
    parsedLocation = dir.parsedQuery?.location ?? combo.locationLabel;
    const mapPayload = enableMapSearch() ? buildMapMarkers(dir.results) : null;
    markers = mapPayload?.markers ?? [];
    missingCoordinatesCount = mapPayload?.missingCoordinatesCount ?? 0;
  } catch {
    rows = [];
  }

  const citizensFallback = getListingsBySubcategory("citizens-advice").slice(0, 3);
  const cities = getDistinctCities({ max: 32 });
  const wideLayout = markers.length > 0;

  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${combo.areaLabel} in ${combo.locationLabel}`,
    itemListElement: rows.slice(0, 20).map((r, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "LegalService",
        name: r.businessName,
        areaServed: combo.locationLabel,
      },
    })),
  };

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: combo.faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <OslawTrendingMarquee />
      <SearchBar compact hideBrand />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />

      <section className="relative border-b border-border py-10 md:py-14">
        <SpiralBackground className="opacity-40" />
        <div className="relative mx-auto w-full max-w-5xl px-4">
          <h1 className="font-serif text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            {combo.areaLabel} in {combo.locationLabel}
          </h1>
          <p className="mt-3 max-w-2xl text-muted-foreground md:text-lg">{combo.intro}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Signposting only — not legal advice. Listings include curated services, GOV.UK legal aid
            providers, and SRA-verified firms.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Link
              href="/find-a-lawyer"
              className="group flex min-h-[7rem] gap-4 rounded-2xl border-2 border-primary/40 bg-primary/5 p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary hover:bg-primary/10 hover:shadow-md"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-card/80">
                <BookOpen className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="font-serif text-lg font-semibold text-foreground group-hover:text-primary">
                  Guided matching
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Tell us your situation and we&apos;ll shortlist legal aid, free help, and solicitors.
                </p>
              </div>
            </Link>
            <Link
              href="/bookmarks"
              className="group flex min-h-[7rem] gap-4 rounded-2xl border-2 border-gold/40 bg-gold/5 p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-gold/70 hover:bg-gold/10 hover:shadow-md"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-card/80">
                <Bookmark className="h-6 w-6 text-gold" />
              </div>
              <div>
                <h2 className="font-serif text-lg font-semibold text-foreground group-hover:text-primary">
                  Save firms
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Bookmark listings from this page to compare them later.
                </p>
              </div>
            </Link>
          </div>
        </div>
      </section>

      <main className={`mx-auto w-full flex-1 px-4 py-10 ${wideLayout ? "max-w-7xl" : "max-w-5xl"}`}>
        <SearchFormWithSuggestions
          key={combo.query}
          initialQuery={combo.query}
          initialFreeOnly={false}
          initialLegalAidOnly={false}
          initialCity={combo.locationLabel}
          cities={cities}
        />

        <div className="mt-8 grid gap-8 lg:grid-cols-[260px_1fr]">
          <SearchDirectorySidebar
            q={combo.query}
            freeOnly={false}
            legalAidOnly={false}
            city={combo.locationLabel}
            practiceArea={combo.practiceAreaSlug}
          />
          <div>
            <DirectorySearchResults
              rows={rows}
              explanations={explanations}
              debugByIndex={debugByIndex}
              q={combo.query}
              parsedPracticeArea={parsedPracticeArea}
              parsedLocation={parsedLocation}
              freeOnly={false}
              legalAidOnly={false}
              cityFacet={combo.locationLabel}
              markers={markers}
              missingCoordinatesCount={missingCoordinatesCount}
              externalFallback={null}
              citizensFallback={citizensFallback}
            />

            <section className="mt-14">
              <h2 className="mb-4 font-serif text-2xl font-semibold text-foreground">
                Frequently asked questions
              </h2>
              <div className="space-y-4">
                {combo.faqs.map((f) => (
                  <div key={f.q}>
                    <h3 className="font-medium text-foreground">{f.q}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{f.a}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
