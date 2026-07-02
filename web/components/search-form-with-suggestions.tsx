"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRequireAuth } from "@/lib/auth/use-require-auth";

type SuggestListing = {
  id: string;
  businessName: string;
  city: string;
  subcategory: string;
  category: string;
};

type SuggestCategory = {
  name: string;
  slug: string;
  parentCategory: string;
};

type Props = {
  initialQuery: string;
  initialFreeOnly: boolean;
  initialLegalAidOnly: boolean;
  initialCity: string;
  cities: string[];
};

function buildSearchParams(q: string, freeOnly: boolean, legalAidOnly: boolean, city: string): string {
  const p = new URLSearchParams();
  const t = q.trim();
  if (t) p.set("q", t);
  if (freeOnly) p.set("free", "1");
  if (legalAidOnly) p.set("legalAid", "1");
  if (city.trim()) p.set("city", city.trim());
  return p.toString();
}

export function SearchFormWithSuggestions({
  initialQuery,
  initialFreeOnly,
  initialLegalAidOnly,
  initialCity,
  cities,
}: Props) {
  const router = useRouter();
  const { requireAuth } = useRequireAuth();
  const listId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [freeOnly, setFreeOnly] = useState(initialFreeOnly);
  const [legalAidOnly, setLegalAidOnly] = useState(initialLegalAidOnly);
  const [city, setCity] = useState(initialCity);
  const [listings, setListings] = useState<SuggestListing[]>([]);
  const [categories, setCategories] = useState<SuggestCategory[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(initialQuery);
    setFreeOnly(initialFreeOnly);
    setLegalAidOnly(initialLegalAidOnly);
    setCity(initialCity);
  }, [initialQuery, initialFreeOnly, initialLegalAidOnly, initialCity]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setListings([]);
      setCategories([]);
      return;
    }
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(q)}`);
          const data = (await res.json()) as { listings?: SuggestListing[]; categories?: SuggestCategory[] };
          setListings(data.listings ?? []);
          setCategories(data.categories ?? []);
        } catch {
          setListings([]);
          setCategories([]);
        }
      })();
    }, 200);
    return () => window.clearTimeout(t);
  }, [query]);

  const flatCount = listings.length + categories.length;

  const goSearch = useCallback(
    (qOverride?: string) => {
      const run = () => {
        const qs = buildSearchParams(qOverride ?? query, freeOnly, legalAidOnly, city);
        router.push(`/search${qs ? `?${qs}` : ""}`);
        setOpen(false);
      };
      requireAuth(run, "search");
    },
    [query, freeOnly, legalAidOnly, city, router, requireAuth],
  );

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || flatCount === 0) {
      if (e.key === "Enter") {
        e.preventDefault();
        goSearch();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i < 0 ? 0 : Math.min(i + 1, flatCount - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? flatCount - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < listings.length) {
        const L = listings[activeIndex]!;
        setQuery(L.businessName);
        goSearch(L.businessName);
      } else if (activeIndex >= listings.length) {
        const c = categories[activeIndex - listings.length]!;
        router.push(`/category/${c.slug}`);
        setOpen(false);
      } else {
        goSearch();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  useEffect(() => {
    setActiveIndex(-1);
  }, [listings, categories]);

  useEffect(() => {
    if (query.trim().length < 2) setOpen(false);
  }, [query]);

  return (
    <form
      role="search"
      className="mb-8 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        goSearch();
      }}
    >
      <div ref={wrapRef} className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          name="q"
          autoComplete="off"
          aria-expanded={open && flatCount > 0}
          aria-controls={flatCount > 0 ? listId : undefined}
          aria-autocomplete="list"
          role="combobox"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => query.trim().length >= 2 && flatCount > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="e.g. mediation, legal aid, drink driving…"
          className="h-12 border-2 border-primary/20 pl-11 text-base"
        />
        {open && query.trim().length >= 2 && flatCount > 0 && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover py-1 text-sm shadow-md"
          >
            {listings.length > 0 && (
              <li className="px-2 py-1 text-xs font-medium text-muted-foreground">Listings</li>
            )}
            {listings.map((L, i) => (
              <li key={L.id} role="option" aria-selected={activeIndex === i}>
                <button
                  type="button"
                  className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted/80 ${
                    activeIndex === i ? "bg-muted/80" : ""
                  }`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setQuery(L.businessName);
                    goSearch(L.businessName);
                  }}
                >
                  <span className="font-medium text-foreground">{L.businessName}</span>
                  <span className="text-xs text-muted-foreground">
                    {[L.city, L.category].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
            {categories.length > 0 && (
              <li className="px-2 py-1 text-xs font-medium text-muted-foreground">Topics</li>
            )}
            {categories.map((c, j) => {
              const idx = listings.length + j;
              return (
                <li key={c.slug} role="option" aria-selected={activeIndex === idx}>
                  <button
                    type="button"
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted/80 ${
                      activeIndex === idx ? "bg-muted/80" : ""
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      router.push(`/category/${c.slug}`);
                      setOpen(false);
                    }}
                  >
                    <span className="font-medium text-foreground">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.parentCategory}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" className="h-11">
          Search
        </Button>
        <div className="flex items-center gap-2">
          <Checkbox
            id="sf-free"
            checked={freeOnly}
            onCheckedChange={(v) => setFreeOnly(v === true)}
          />
          <Label htmlFor="sf-free" className="cursor-pointer text-sm text-muted-foreground">
            Free only
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="sf-la"
            checked={legalAidOnly}
            onCheckedChange={(v) => setLegalAidOnly(v === true)}
          />
          <Label htmlFor="sf-la" className="cursor-pointer text-sm text-muted-foreground">
            Legal aid listings only
          </Label>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px]">
          <Label htmlFor="sf-city" className="mb-1 block text-xs font-medium text-muted-foreground">
            City
          </Label>
          <select
            id="sf-city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Any city</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
    </form>
  );
}
