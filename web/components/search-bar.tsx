"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, Building2, FolderOpen } from "lucide-react";
import Image from "next/image";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SpiralDecoration } from "./spiral-decoration";

type SuggestListing = {
  id: string;
  businessName: string;
  city: string;
  subcategory: string;
  category: string;
  isFree: boolean;
  isLegalAid?: boolean;
};

type SuggestCategory = {
  name: string;
  slug: string;
  parentCategory: string;
};

type SuggestResponse = {
  listings: SuggestListing[];
  categories: SuggestCategory[];
};

export function SearchBar() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SuggestResponse | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(async () => {
      const trimmed = q.trim();
      if (trimmed.length < 2) {
        setData(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(
          `/api/search/suggest?q=${encodeURIComponent(trimmed)}`,
          { cache: "no-store" },
        );
        setData((await res.json()) as SuggestResponse);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => window.clearTimeout(t);
  }, [q]);

  const goSearch = useCallback(
    (query: string, semantic?: boolean) => {
      const params = new URLSearchParams();
      params.set("q", query.trim());
      if (semantic) params.set("semantic", "1");
      router.push(`/search?${params.toString()}`);
      setOpen(false);
    },
    [router],
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    goSearch(q, false);
  };

  const showPanel = open && q.trim().length >= 2;

  return (
    <div className="relative overflow-hidden border-b-2 border-gold/30 bg-gradient-to-br from-primary/5 via-background to-secondary/5 py-12">
      {/* Decorative spirals */}
      <div className="absolute -left-20 -top-20 opacity-15">
        <SpiralDecoration size={250} color="var(--teal)" />
      </div>
      <div className="absolute -bottom-16 -right-16 opacity-15">
        <SpiralDecoration size={200} color="var(--coral)" />
      </div>
      
      <div className="relative mx-auto max-w-4xl px-4 text-center">
        <div className="mb-6 flex justify-center">
          <div className="relative">
            <div className="absolute -inset-3 rounded-full bg-gradient-to-br from-primary/20 via-secondary/20 to-accent/20 blur-lg" />
            <Image
              src="/logo.jpg"
              alt="Legal Shaman Logo"
              width={100}
              height={100}
              className="relative h-24 w-24 rounded-full border-4 border-gold/50 shadow-lg"
            />
          </div>
        </div>
        <h1 className="mb-2 font-serif text-3xl font-bold tracking-tight md:text-4xl lg:text-5xl">
          <span className="text-primary">Legal</span>{" "}
          <span className="text-secondary">Shaman</span>
        </h1>
        <p className="mb-1 text-base font-medium text-foreground md:text-lg">
          The Most Powerful Agentic Search Engine for All Your Disputes
        </p>
        <p className="mb-8 text-muted-foreground">
          Tell us your problem and we&apos;ll point you in the right direction — solicitors, legal aid, free advice, and more.
        </p>
        
        <form onSubmit={onSubmit} className="mx-auto flex max-w-2xl flex-col gap-3 sm:flex-row">
          <div ref={wrapRef} className="relative flex-1 text-left">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder="Search legal advice, solicitors, charities…"
              className="h-14 border-2 border-gold/30 bg-card pl-12 text-base placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-gold/30"
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={showPanel}
              role="combobox"
            />
            {showPanel && (
              <div
                className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-auto rounded-xl border-2 border-gold/30 bg-popover text-popover-foreground shadow-xl"
                role="listbox"
              >
                {loading && (
                  <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    Searching…
                  </div>
                )}
                {!loading && data && (
                  <>
                    {data.categories.length > 0 && (
                      <div className="border-b border-border px-2 py-2">
                        <div className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-gold">
                          Categories
                        </div>
                        {data.categories.map((c) => (
                          <button
                            key={c.slug}
                            type="button"
                            role="option"
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-left text-sm hover:bg-primary/10"
                            onClick={() => router.push(`/category/${c.slug}`)}
                          >
                            <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                            <span>
                              <span className="font-medium">{c.name}</span>
                              <span className="text-muted-foreground"> · {c.parentCategory}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {data.listings.length > 0 && (
                      <div className="px-2 py-2">
                        <div className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-gold">
                          Organisations
                        </div>
                        {data.listings.map((l) => (
                          <button
                            key={l.id}
                            type="button"
                            role="option"
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-left text-sm hover:bg-secondary/10"
                            onClick={() => router.push(`/category/${l.subcategory}`)}
                          >
                            <Building2 className="h-4 w-4 shrink-0 text-secondary" />
                            <span>
                              <span className="font-medium">{l.businessName}</span>
                              {l.city ? (
                                <span className="text-muted-foreground"> · {l.city}</span>
                              ) : null}
                              {l.isLegalAid ? (
                                <span className="ml-2 rounded-full bg-primary/20 px-2 py-0.5 text-xs text-primary">Legal Aid</span>
                              ) : null}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {!data.categories.length && !data.listings.length && (
                      <div className="px-4 py-4 text-sm text-muted-foreground">No suggestions — press Search</div>
                    )}
                    <div className="border-t border-border px-2 py-2">
                      <button
                        type="button"
                        className="w-full rounded-lg px-2 py-2.5 text-left text-sm font-medium text-primary hover:bg-primary/10"
                        onClick={() => goSearch(q, true)}
                      >
                        Search all with smart match →
                      </button>
                      <button
                        type="button"
                        className="w-full rounded-lg px-2 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted"
                        onClick={() => goSearch(q, false)}
                      >
                        View all text matches →
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <Button type="submit" className="h-14 px-8 text-base font-medium bg-primary hover:bg-primary/90 hover:scale-[1.02] transition-all shadow-lg">
            Search
          </Button>
        </form>
      </div>
    </div>
  );
}
