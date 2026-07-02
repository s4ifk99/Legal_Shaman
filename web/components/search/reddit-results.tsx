"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatOslawSearchSubredditList } from "@/lib/oslaw/config";

type RedditResult = {
  id: string;
  title: string;
  url: string;
  subreddit: string;
  score: number;
  comments: number;
  snippet?: string;
};

type RedditResultsProps = {
  query: string;
  enabled: boolean;
};

export function RedditResults({ query, enabled }: RedditResultsProps) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RedditResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || trimmed.length < 2) {
      setResults([]);
      setError(null);
      setNotice(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotice(null);

    fetch(`/api/oslaw/search?q=${encodeURIComponent(trimmed)}&limit=8`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const payload = (await res.json()) as {
          results?: RedditResult[];
          error?: string;
          message?: string;
          degraded?: boolean;
        };
        if (!res.ok) {
          throw new Error(payload.message || payload.error || "reddit_request_failed");
        }
        if (!cancelled) {
          setResults(payload.results ?? []);
          if (payload.degraded && payload.message) {
            setNotice(payload.message);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "reddit_request_failed");
          setResults([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [query, enabled]);

  if (!enabled || query.trim().length < 2) return null;

  return (
    <Card className="mt-6 border-2 border-gold/30">
      <CardContent className="p-4">
        <h2 className="font-serif text-xl font-semibold text-foreground">OSLAW — Reddit search</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Live results from {formatOslawSearchSubredditList()} for:{" "}
          <span className="font-medium text-foreground">{query}</span>
        </p>

        {loading ? <p className="mt-3 text-sm text-muted-foreground">Loading Reddit results...</p> : null}
        {notice ? (
          <p className="mt-3 text-sm text-amber-800 dark:text-amber-200">{notice}</p>
        ) : null}
        {error ? (
          <p className="mt-3 text-sm text-destructive">
            Reddit search unavailable: {error}.{" "}
            <Link href="/ask-the-shaman" className="font-medium underline">
              Browse OSLAW trending
            </Link>
          </p>
        ) : null}

        {!loading && !error && results.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No Reddit results found for this query.{" "}
            <Link href="/ask-the-shaman" className="font-medium text-primary hover:underline">
              See trending topics
            </Link>
          </p>
        ) : null}

        {results.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {results.map((item) => (
              <li key={item.id} className="rounded-lg border border-border p-3">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  {item.title}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.subreddit} · {item.score} score · {item.comments} comments
                </p>
                {item.snippet ? (
                  <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{item.snippet}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
