"use client";

import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OslawPostList } from "@/components/oslaw/post-list";
import type { OslawPost } from "@/lib/oslaw/types";
import { formatOslawSearchSubredditList } from "@/lib/oslaw/config";

type SearchResult = {
  id: string;
  title: string;
  url: string;
  subreddit: string;
  score: number;
  comments: number;
  snippet?: string;
  createdUtc?: number;
};

type OslawSearchPanelProps = {
  initialQuery?: string;
};

function toOslawPost(result: SearchResult): OslawPost {
  const subreddit = result.subreddit.replace(/^r\//, "");
  return {
    id: result.id,
    title: result.title,
    url: result.url,
    permalink: result.url,
    subreddit,
    score: result.score,
    numComments: result.comments,
    createdUtc: result.createdUtc ?? Math.floor(Date.now() / 1000),
    snippet: result.snippet ?? "",
    listingSource: "search",
  };
}

export function OslawSearchPanel({ initialQuery = "" }: OslawSearchPanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery.trim());
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<OslawPost[]>([]);
  const [source, setSource] = useState<"oauth" | "rss" | "public" | "cached" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) return;

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch(`/api/oslaw/search?q=${encodeURIComponent(trimmed)}&limit=15`, {
        cache: "no-store",
      });
      const payload = (await res.json()) as {
        results?: SearchResult[];
        source?: "oauth" | "rss" | "public" | "cached";
        degraded?: boolean;
        message?: string;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(payload.message || payload.error || "Search failed");
      }

      setResults((payload.results ?? []).map(toOslawPost));
      setSource(payload.source ?? "rss");
      if (payload.degraded && payload.message) {
        setNotice(payload.message);
      }
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialQuery.trim().length >= 2) {
      void runSearch(initialQuery);
    }
  }, [initialQuery, runSearch]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(query.trim());
    void runSearch(query);
  }

  return (
    <div className="mt-6">
      <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-2 sm:flex-row">
        <input
          name="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search UK legal Reddit — e.g. section 21, parking PCN, unfair dismissal"
          className="h-11 flex-1 rounded-lg border border-border bg-background px-4 text-foreground"
          minLength={2}
          required
        />
        <Button type="submit" className="h-11 gap-2 bg-gold text-gold-foreground hover:bg-gold/90" disabled={loading}>
          <Search className="h-4 w-4" />
          {loading ? "Searching…" : "Search live"}
        </Button>
      </form>

      <p className="mt-2 text-xs text-muted-foreground">
        Searches {formatOslawSearchSubredditList()} in real time — housing, employment, parking,
        benefits, and more.
      </p>

      {submitted.length >= 2 ? (
        <div className="mt-8">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="font-serif text-xl font-semibold text-foreground">
              Results for &ldquo;{submitted}&rdquo;
            </h2>
            {source === "oauth" || source === "rss" || source === "public" ? (
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                {source === "rss" ? "Live (RSS)" : source === "oauth" ? "Live" : "Live"}
              </span>
            ) : null}
          </div>

          {loading ? <p className="text-sm text-muted-foreground">Fetching live Reddit results…</p> : null}
          {notice ? <p className="mb-3 text-sm text-amber-800 dark:text-amber-200">{notice}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {!loading && !error ? (
            <OslawPostList
              posts={results}
              emptyMessage={`No live Reddit posts matched "${submitted}". Try different keywords.`}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
