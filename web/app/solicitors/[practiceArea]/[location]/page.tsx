import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Phone, Globe, ExternalLink, MapPin, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { runDirectorySearch } from "@/lib/legal-search/run-directory-search";
import type { LegacyGetRow } from "@/lib/legal-search/legacy-get-response";

// Render on demand (like /search). Avoids a build-time database dependency and
// keeps directory results fresh as the underlying data updates.
export const dynamic = "force-dynamic";

const BASE = "https://www.legalshaman.com";

type Combo = {
  areaLabel: string; // H1 / title fragment, e.g. "Divorce & Family Law"
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

type DisplayRow = {
  id: string;
  name: string;
  description: string;
  city: string;
  postcode: string;
  phone: string;
  website?: string;
  sraProfileUrl?: string;
  isLegalAid: boolean;
  isFree: boolean;
  isSra: boolean;
};

function toDisplayRow(row: LegacyGetRow): DisplayRow {
  if (row.kind === "adlGroup") {
    const loc = (row.locations[0] ?? {}) as Record<string, string>;
    return {
      id: row.id,
      name: row.businessName,
      description: row.description,
      city: loc.city ?? "",
      postcode: loc.postcode ?? "",
      phone: loc.phone ?? "",
      website: loc.website || undefined,
      isLegalAid: true,
      isFree: row.isFree,
      isSra: false,
    };
  }
  return {
    id: row.id,
    name: row.businessName,
    description: row.description,
    city: row.city,
    postcode: row.postcode,
    phone: row.phone,
    website: row.website,
    sraProfileUrl: row.sraProfileUrl,
    isLegalAid: Boolean(row.isLegalAid),
    isFree: row.isFree,
    isSra: row.sourceType === "sra",
  };
}

export default async function SolicitorsLandingPage({ params }: PageProps) {
  const { practiceArea, location } = await params;
  const combo = COMBOS[comboKey(practiceArea, location)];
  if (!combo) {
    notFound();
  }

  let rows: DisplayRow[] = [];
  try {
    const dir = await runDirectorySearch({
      query: combo.query,
      limit: 24,
      semantic: false,
      city: combo.locationLabel,
      practiceArea: combo.practiceAreaSlug,
    });
    rows = (dir.legacyRows as LegacyGetRow[]).map(toDisplayRow);
  } catch {
    rows = [];
  }

  const canonical = `${BASE}/solicitors/${practiceArea.toLowerCase()}/${location.toLowerCase()}`;

  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${combo.areaLabel} in ${combo.locationLabel}`,
    itemListElement: rows.slice(0, 20).map((r, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "LegalService",
        name: r.name,
        areaServed: combo.locationLabel,
        ...(r.website ? { url: r.website } : {}),
        ...(r.phone ? { telephone: r.phone } : {}),
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <div className="mb-6">
          <Link
            href="/search"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Search the full directory
          </Link>
        </div>

        <h1 className="mb-3 font-serif text-3xl font-semibold text-primary">
          {combo.areaLabel} in {combo.locationLabel}
        </h1>
        <p className="mb-4 max-w-2xl text-muted-foreground">{combo.intro}</p>
        <p className="mb-6 text-xs text-muted-foreground">
          This is not legal advice. Listings include curated services, GOV.UK legal aid providers,
          and SRA-verified firms.
        </p>

        <div className="mb-8 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/ask-the-shaman?guided=1">Find a lawyer (guided)</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href={`/search?q=${encodeURIComponent(combo.query)}`}>Refine this search</Link>
          </Button>
        </div>

        {rows.length > 0 ? (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-foreground">
              {combo.areaShort.replace(/^\w/, (c) => c.toUpperCase())} help in {combo.locationLabel}
            </h2>
            {rows.map((r) => (
              <ResultCard key={r.id} row={r} />
            ))}
          </section>
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              We couldn&apos;t load listings right now.{" "}
              <Link href="/search" className="text-primary underline">
                Search the directory
              </Link>{" "}
              instead.
            </CardContent>
          </Card>
        )}

        <section className="mt-12">
          <h2 className="mb-4 text-xl font-semibold text-foreground">Frequently asked questions</h2>
          <div className="space-y-4">
            {combo.faqs.map((f) => (
              <div key={f.q}>
                <h3 className="font-medium text-foreground">{f.q}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{f.a}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function ResultCard({ row }: { row: DisplayRow }) {
  const addressLine = [row.city, row.postcode].map((p) => (p || "").trim()).filter(Boolean).join(", ");
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-lg font-semibold text-foreground">{row.name}</h3>
          <div className="flex flex-wrap gap-2">
            {row.isSra && (
              <Badge variant="outline" className="border-primary/30 text-primary">
                <ShieldCheck className="mr-1 h-3 w-3" />
                SRA-verified
              </Badge>
            )}
            {row.isFree && <Badge className="bg-green-100 text-green-800">Free</Badge>}
            {row.isLegalAid && (
              <Badge variant="outline" className="border-primary/30 text-primary">
                Legal Aid *
              </Badge>
            )}
          </div>
        </div>
        {row.description && (
          <p className="mb-3 text-sm text-muted-foreground">{row.description}</p>
        )}
        {addressLine && (
          <div className="mb-2 flex items-start gap-2 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{addressLine}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-4">
          {row.phone && (
            <a href={`tel:${row.phone}`} className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline">
              <Phone className="h-4 w-4" />
              {row.phone}
            </a>
          )}
          {row.website && (
            <a
              href={row.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
            >
              <Globe className="h-4 w-4" />
              Visit website
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {row.sraProfileUrl && (
            <a
              href={row.sraProfileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
            >
              <ShieldCheck className="h-4 w-4" />
              SRA profile
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
