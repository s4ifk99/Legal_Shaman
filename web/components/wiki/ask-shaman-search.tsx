"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Search, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type WikiSearchHit = {
  id: string;
  title: string;
  category: string;
  summary: string;
  keyInformation: string[];
  practicalGuidance: string[];
  relatedConcepts: string[];
  score: number;
};

type AskShamanSearchProps = {
  initialQuery?: string;
};

export function AskShamanSearch({ initialQuery = "" }: AskShamanSearchProps) {
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<WikiSearchHit[]>([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const trimmed = initialQuery.trim();
    if (trimmed.length >= 2) {
      void runSearch(trimmed);
    }
  }, [initialQuery]);

  async function runSearch(q: string) {
    const trimmed = q.trim();
    if (trimmed.length < 2) return;

    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/ask?q=${encodeURIComponent(trimmed)}&limit=12`, {
        cache: "no-store",
      });
      const payload = (await res.json()) as { results?: WikiSearchHit[] };
      setResults(payload.results ?? []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    const url = new URL(window.location.href);
    url.searchParams.set("q", trimmed);
    window.history.replaceState({}, "", url.toString());
    void runSearch(trimmed);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. unfair dismissal, tenancy deposit, divorce…"
            className="h-12 border-gold/30 pl-10 text-base"
            minLength={2}
            required
          />
        </div>
        <Button
          type="submit"
          className="h-12 gap-2 bg-gold px-6 text-gold-foreground hover:bg-gold/90"
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Ask
        </Button>
      </form>

      {loading ? (
        <p className="text-sm text-muted-foreground">Searching the knowledge wiki…</p>
      ) : null}

      {!loading && searched && results.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No wiki pages matched your question. Try different words (e.g. &quot;housing repairs&quot;,
          &quot;redundancy&quot;).
        </p>
      ) : null}

      {results.length > 0 ? (
        <ul className="space-y-4">
          {results.map((hit) => (
            <li key={hit.id}>
              <Card className="border border-border/70 transition-colors hover:border-gold/40">
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-gold">
                        {hit.category}
                      </p>
                      <Link
                        href={`/ask-the-shaman/wiki/${encodeURIComponent(hit.id)}`}
                        className="mt-1 font-serif text-lg font-semibold text-foreground hover:text-primary"
                      >
                        {hit.title}
                      </Link>
                    </div>
                  </div>

                  {hit.summary ? (
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground line-clamp-3">
                      {hit.summary}
                    </p>
                  ) : null}

                  {hit.keyInformation.length ? (
                    <ul className="mt-3 space-y-1 text-sm text-foreground">
                      {hit.keyInformation.slice(0, 3).map((item) => (
                        <li key={item} className="flex gap-2">
                          <span className="text-gold">•</span>
                          <span className="line-clamp-2">{item.replace(/\[\[([^\]]+)\]\]/g, "$1")}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <Link
                    href={`/ask-the-shaman/wiki/${encodeURIComponent(hit.id)}`}
                    className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
                  >
                    Read full guidance →
                  </Link>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
