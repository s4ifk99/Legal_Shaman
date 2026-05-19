import Link from "next/link";

type Props = {
  q: string;
  freeOnly: boolean;
  legalAidOnly: boolean;
  city: string;
  source?: string;
  practiceArea?: string;
};

function href(base: Props, patch: Partial<Props>): string {
  const q = patch.q ?? base.q;
  const free = patch.freeOnly ?? base.freeOnly;
  const la = patch.legalAidOnly ?? base.legalAidOnly;
  const city = patch.city ?? base.city;
  const source = patch.source !== undefined ? patch.source : base.source;
  const practiceArea = patch.practiceArea !== undefined ? patch.practiceArea : base.practiceArea;
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (free) p.set("free", "1");
  if (la) p.set("legalAid", "1");
  if (city) p.set("city", city);
  if (source) p.set("source", source);
  if (practiceArea) p.set("practiceArea", practiceArea);
  const qs = p.toString();
  return qs ? `/search?${qs}` : "/search";
}

export function SearchDirectorySidebar(props: Props) {
  const { q, freeOnly, legalAidOnly, city, source, practiceArea } = props;
  if (!q || q.length < 2) return null;

  return (
    <aside className="rounded-lg border bg-card p-4 text-sm">
      <p className="mb-3 font-medium text-foreground">Filters</p>
      <div className="flex flex-col gap-2">
        <Link
          href={href(props, { source: undefined })}
          className={`block ${!source ? "font-medium text-primary" : "text-muted-foreground hover:underline"}`}
        >
          All sources
        </Link>
        <Link
          href={href(props, { source: "curated" })}
          className={`block ${source === "curated" ? "font-medium text-primary" : "text-muted-foreground hover:underline"}`}
        >
          Curated only
        </Link>
        <Link
          href={href(props, { source: "private" })}
          className={`block ${source === "private" ? "font-medium text-primary" : "text-muted-foreground hover:underline"}`}
        >
          Private firms
        </Link>
        <Link
          href={href(props, { source: "legal_aid" })}
          className={`block ${source === "legal_aid" ? "font-medium text-primary" : "text-muted-foreground hover:underline"}`}
        >
          Legal aid listings
        </Link>
        <Link
          href={href(props, { source: "sra" })}
          className={`block ${source === "sra" ? "font-medium text-primary" : "text-muted-foreground hover:underline"}`}
        >
          SRA organisations
        </Link>
      </div>
      <p className="mb-2 mt-4 font-medium text-foreground">Practice area hint</p>
      <div className="flex flex-wrap gap-1.5">
        {["employment", "immigration", "family", "housing", "criminal_defence"].map((slug) => (
          <Link
            key={slug}
            href={href(props, { practiceArea: practiceArea === slug ? undefined : slug })}
            className={`rounded-full border px-2 py-0.5 text-xs ${
              practiceArea === slug ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
            }`}
          >
            {slug}
          </Link>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Sort by relevance uses the unified ranker when <code className="rounded bg-muted px-1">ENABLE_UNIFIED_DIRECTORY=true</code>.
      </p>
    </aside>
  );
}
