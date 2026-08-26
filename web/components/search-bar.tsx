"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, Building2, FolderOpen } from "lucide-react";
import Image from "next/image";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { SpiralDecoration } from "./spiral-decoration";
import { cn } from "@/lib/utils";
import { useRequireAuth } from "@/lib/auth/use-require-auth";

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

/** Long / multi-word stories are not org/category lookups — skip empty suggest UI. */
function looksLikeStoryQuery(q: string): boolean {
  const t = q.trim();
  if (t.length >= 40) return true;
  const words = t.split(/\s+/).filter(Boolean);
  return words.length >= 6;
}

export function SearchBar({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { requireAuth } = useRequireAuth();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SuggestResponse | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const resizeArea = useCallback(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(Math.max(el.scrollHeight, 56), 220);
    el.style.height = `${next}px`;
  }, []);

  useLayoutEffect(() => {
    resizeArea();
  }, [q, resizeArea]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2 || looksLikeStoryQuery(trimmed)) {
      setData(null);
      setLoading(false);
      return;
    }

    const t = window.setTimeout(async () => {
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
      const run = () => {
        const params = new URLSearchParams();
        params.set("q", query.trim());
        if (semantic) params.set("semantic", "1");
        router.push(`/ask-the-shaman?${params.toString()}`);
        setOpen(false);
      };
      requireAuth(run, "search");
    },
    [router, requireAuth],
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    goSearch(q, false);
  };

  const hasHits = Boolean(
    data && (data.categories.length > 0 || data.listings.length > 0),
  );
  const storyMode = looksLikeStoryQuery(q);
  // Only show the panel when there is something useful — never an empty "No suggestions" box
  const showPanel = open && !storyMode && q.trim().length >= 2 && (loading || hasHits);

  return (
    <div
      className={cn(
        "relative overflow-hidden border-b-2 border-gold/30 bg-gradient-to-br from-primary/5 via-background to-secondary/5",
        compact ? "py-8 md:py-10" : "py-12",
      )}
    >
      <div className="absolute -left-20 -top-20 opacity-15">
        <SpiralDecoration size={250} color="var(--teal)" />
      </div>
      <div className="absolute -bottom-16 -right-16 opacity-15">
        <SpiralDecoration size={200} color="var(--coral)" />
      </div>

      <div className="relative mx-auto max-w-4xl px-4 text-center">
        {!compact && (
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
        )}
        {!compact ? (
          <>
            <h1 className="mb-2 font-serif text-3xl font-bold tracking-tight md:text-4xl lg:text-5xl">
              <span className="text-primary">Legal</span>{" "}
              <span className="text-secondary">Shaman</span>
            </h1>
            <p className="mb-1 text-base font-medium text-foreground md:text-lg">
              Justice through Search
            </p>
          </>
        ) : (
          <>
            <div className="mb-4 flex justify-center">
              <Image
                src="/logo.jpg"
                alt="Legal Shaman Logo"
                width={72}
                height={72}
                className="h-16 w-16 rounded-full border-2 border-gold/50 shadow-md md:h-[4.5rem] md:w-[4.5rem]"
              />
            </div>
            <h1 className="mb-1 font-serif text-3xl font-bold tracking-tight text-foreground md:text-4xl lg:text-5xl">
              <span className="text-primary">Legal</span>{" "}
              <span className="text-secondary">Shaman</span>
            </h1>
            <p className="mb-2 text-base font-medium text-foreground md:text-lg">
              Justice through Search
            </p>
          </>
        )}
        <p className={cn("text-muted-foreground", compact ? "mb-6 md:text-lg" : "mb-8")}>
          Tell us your problem and we&apos;ll point you in the right direction — solicitors, legal
          aid, free advice, and more.
        </p>

        <form
          onSubmit={onSubmit}
          className="mx-auto flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div ref={wrapRef} className="relative flex-1 text-left">
            <Search className="pointer-events-none absolute left-4 top-4 z-10 h-5 w-5 text-muted-foreground" />
            <Textarea
              ref={areaRef}
              value={q}
              rows={1}
              onChange={(e) => {
                setQ(e.target.value);
                if (!looksLikeStoryQuery(e.target.value)) setOpen(true);
                else setOpen(false);
              }}
              onFocus={() => {
                if (!looksLikeStoryQuery(q)) setOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (q.trim()) goSearch(q, false);
                }
              }}
              placeholder="Describe your situation in your own words — or search solicitors and charities…"
              className="min-h-14 max-h-[220px] resize-none overflow-y-auto border-2 border-gold/30 bg-card py-3.5 pl-12 pr-4 text-base leading-relaxed placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-gold/30"
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
                {!loading && hasHits && data && (
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
                            onClick={() =>
                              requireAuth(() => router.push(`/category/${c.slug}`), "search")
                            }
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
                            onClick={() => goSearch(l.businessName)}
                          >
                            <Building2 className="h-4 w-4 shrink-0 text-secondary" />
                            <span>
                              <span className="font-medium">{l.businessName}</span>
                              {l.city ? (
                                <span className="text-muted-foreground"> · {l.city}</span>
                              ) : null}
                              {l.isLegalAid ? (
                                <span className="ml-2 rounded-full bg-primary/20 px-2 py-0.5 text-xs text-primary">
                                  Legal Aid
                                </span>
                              ) : null}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="border-t border-border px-2 py-2">
                      <button
                        type="button"
                        className="w-full rounded-lg px-2 py-2.5 text-left text-sm font-medium text-primary hover:bg-primary/10"
                        onClick={() => goSearch(q, true)}
                      >
                        Search all with smart match →
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            {storyMode && q.trim().length > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Enter to search · Shift+Enter for a new line
              </p>
            ) : null}
          </div>
          <Button
            type="submit"
            className="h-14 shrink-0 px-8 text-base font-medium bg-primary shadow-lg transition-all hover:scale-[1.02] hover:bg-primary/90 sm:self-stretch"
          >
            Search
          </Button>
        </form>
      </div>
    </div>
  );
}
