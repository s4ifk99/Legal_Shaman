"use client";

import Link from "next/link";
import { useLocale } from "@/components/i18n/locale-provider";
import { localePath, type LocaleCode } from "@/lib/i18n/locales";

type Props = {
  q: string;
  freeOnly: boolean;
  legalAidOnly: boolean;
  city: string;
  source?: string;
  practiceArea?: string;
  reviews?: string;
  cost?: string;
};

function href(locale: LocaleCode, base: Props, patch: Partial<Props>): string {
  const q = patch.q ?? base.q;
  const free = patch.freeOnly ?? base.freeOnly;
  const la = patch.legalAidOnly ?? base.legalAidOnly;
  const city = patch.city ?? base.city;
  const source = patch.source !== undefined ? patch.source : base.source;
  const practiceArea = patch.practiceArea !== undefined ? patch.practiceArea : base.practiceArea;
  const reviews = patch.reviews !== undefined ? patch.reviews : base.reviews;
  const cost = patch.cost !== undefined ? patch.cost : base.cost;
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (free) p.set("free", "1");
  if (la) p.set("legalAid", "1");
  if (city) p.set("city", city);
  if (source) p.set("source", source);
  if (practiceArea) p.set("practiceArea", practiceArea);
  if (reviews && reviews !== "all") p.set("reviews", reviews);
  if (cost && cost !== "all") p.set("cost", cost);
  const qs = p.toString();
  return localePath(locale, qs ? `/search?${qs}` : "/search");
}

export function SearchDirectorySidebar(props: Props) {
  const { q, source, practiceArea } = props;
  const { locale, t } = useLocale();
  if (!q || q.length < 2) return null;
  const areas = [
    { slug: "employment", label: t.employment },
    { slug: "immigration", label: t.immigration },
    { slug: "family", label: t.family },
    { slug: "housing", label: t.housing },
    { slug: "criminal_defence", label: t.criminalDefence },
  ] as const;

  return (
    <aside className="rounded-lg border bg-card p-4 text-sm">
      <p className="mb-3 font-medium text-foreground">{t.filters}</p>
      <div className="flex flex-col gap-2">
        <Link
          href={href(locale, props, { source: undefined })}
          className={`block ${!source ? "font-medium text-primary" : "text-muted-foreground hover:underline"}`}
        >
          {t.allSources}
        </Link>
        <Link
          href={href(locale, props, { source: "curated" })}
          className={`block ${source === "curated" ? "font-medium text-primary" : "text-muted-foreground hover:underline"}`}
        >
          {t.curated}
        </Link>
        <Link
          href={href(locale, props, { source: "private" })}
          className={`block ${source === "private" ? "font-medium text-primary" : "text-muted-foreground hover:underline"}`}
        >
          {t.privateFirms}
        </Link>
        <Link
          href={href(locale, props, { source: "legal_aid" })}
          className={`block ${source === "legal_aid" ? "font-medium text-primary" : "text-muted-foreground hover:underline"}`}
        >
          {t.legalAidListings}
        </Link>
        <Link
          href={href(locale, props, { source: "sra" })}
          className={`block ${source === "sra" ? "font-medium text-primary" : "text-muted-foreground hover:underline"}`}
        >
          {t.sraOrgs}
        </Link>
      </div>
      <p className="mb-2 mt-4 font-medium text-foreground">{t.practiceArea}</p>
      <div className="flex flex-wrap gap-1.5">
        {areas.map(({ slug, label }) => (
          <Link
            key={slug}
            href={href(locale, props, { practiceArea: practiceArea === slug ? undefined : slug })}
            className={`rounded-full border px-2 py-0.5 text-xs ${
              practiceArea === slug ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
    </aside>
  );
}
