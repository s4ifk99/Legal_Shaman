"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, MapPin, Search, Sparkles } from "lucide-react";

import { SearchCriteriaPanel } from "@/components/legal-search/search-criteria-panel";
import { ExpandableDirectoryList } from "@/components/search/expandable-directory-list";
import type { DirectoryListItem } from "@/components/search/expandable-directory-list";
import { ShamanRecommends } from "@/components/legal-search/shaman-recommends";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { LegalSearchResponse, SearchCriterion } from "@/lib/legal-knowledge/types";
import { cn } from "@/lib/utils";
import { useRequireAuth } from "@/lib/auth/use-require-auth";

type LegalKnowledgeSearchProps = {
  initialQuery?: string;
  initialLocation?: string;
};

function confidenceLabel(score: number): string {
  if (score >= 0.68) return "High confidence";
  if (score >= 0.38) return "Moderate confidence";
  return "Low confidence";
}

function confidenceColor(score: number): string {
  if (score >= 0.68) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 0.38) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

export function LegalKnowledgeSearch({
  initialQuery = "",
  initialLocation = "",
}: LegalKnowledgeSearchProps) {
  const { requireAuth, openAuthForSearch, user, loading: authLoading } = useRequireAuth();
  const [query, setQuery] = useState(initialQuery);
  const [location, setLocation] = useState(initialLocation);
  const [criteria, setCriteria] = useState<SearchCriterion[]>([]);
  const [result, setResult] = useState<LegalSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [decomposing, setDecomposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const fetchCriteria = useCallback(async (q: string, loc: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setCriteria([]);
      return;
    }
    setDecomposing(true);
    try {
      const res = await fetch("/api/legal-search/decompose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: trimmed,
          location: loc.trim() || undefined,
          includeDirectory: true,
        }),
      });
      const payload = (await res.json()) as { searchCriteria?: SearchCriterion[] };
      if (res.ok && payload.searchCriteria) {
        setCriteria(payload.searchCriteria);
      }
    } catch {
      /* preview is best-effort */
    } finally {
      setDecomposing(false);
    }
  }, []);

  useEffect(() => {
    const trimmed = initialQuery.trim();
    if (trimmed.length < 2 || authLoading) return;
    void runSearch(trimmed, initialLocation);
  }, [initialQuery, initialLocation, authLoading]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setCriteria([]);
      return;
    }
    const timer = setTimeout(() => {
      void fetchCriteria(query, location);
    }, 350);
    return () => clearTimeout(timer);
  }, [query, location, fetchCriteria]);

  async function runSearch(q: string, loc = location) {
    const trimmed = q.trim();
    if (trimmed.length < 2) return;

    setLoading(true);
    setSearched(true);
    setError(null);

    try {
      const res = await fetch("/api/legal-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: trimmed,
          location: loc.trim() || undefined,
          includeDirectory: true,
        }),
      });
      const payload = (await res.json()) as LegalSearchResponse & { error?: string };
      if (res.status === 401) {
        openAuthForSearch(() => void runSearch(trimmed, loc));
        return;
      }
      if (!res.ok) throw new Error(payload.error || "search_failed");
      setResult(payload);
      if (payload.searchCriteria?.length) setCriteria(payload.searchCriteria);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "search_failed");
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
    if (location.trim()) url.searchParams.set("location", location.trim());
    else url.searchParams.delete("location");
    window.history.replaceState({}, "", url.toString());
    void runSearch(trimmed);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Describe your legal problem in plain English…"
            className="h-12 pl-10 text-base"
            autoFocus
          />
        </div>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Optional: city or postcode for directory results"
            className="h-10 pl-10"
          />
        </div>
        <Button type="submit" disabled={loading || query.trim().length < 2} className="w-full sm:w-auto">
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Searching…
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Search legal guidance
            </>
          )}
        </Button>
      </form>

      {(criteria.length > 0 || loading || decomposing) && (
        <SearchCriteriaPanel
          query={query.trim()}
          criteria={criteria}
          loading={loading || decomposing}
        />
      )}

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}

      {result && searched ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className={cn("text-sm font-medium", confidenceColor(result.confidence))}>
              {confidenceLabel(result.confidence)} ({Math.round(result.confidence * 100)}%)
            </span>
            {result.issueClassification.area ? (
              <span className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground">
                {result.issueClassification.specificIssue
                  ? `${result.issueClassification.area} · ${result.issueClassification.specificIssue}`
                  : result.issueClassification.area}
              </span>
            ) : null}
            {result.debug?.mode ? (
              <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
                {result.debug.mode.replace(/_/g, " ")}
              </span>
            ) : null}
          </div>

          {result.clarifyingQuestion ? (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="p-4 text-sm">
                <p className="font-medium text-foreground">Clarifying question</p>
                <p className="mt-1 text-muted-foreground">{result.clarifyingQuestion}</p>
              </CardContent>
            </Card>
          ) : null}

          {result.answer ? (
            <Card>
              <CardContent className="space-y-4 p-5">
                <h3 className="font-serif text-lg font-semibold text-primary">Shaman Recommends</h3>
                <ShamanRecommends
                  answer={result.answer}
                  sources={result.sources}
                  confidence={result.confidence}
                />
                <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                  {result.disclaimer}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {result.sources.length > 0 ? (
            <section className="space-y-3">
              <h3 className="font-serif text-lg font-semibold text-foreground">
                Sources ({result.sources.length})
              </h3>
              <div className="space-y-2">
                {result.sources.map((source, i) => (
                  <Card key={`${source.url}-${i}`} className="overflow-hidden">
                    <CardContent className="flex gap-3 p-4">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-start gap-1 font-medium text-primary hover:underline"
                        >
                          {source.title}
                          <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        </a>
                        <p className="text-xs text-muted-foreground">{source.source}</p>
                        <p className="mt-1 text-sm text-muted-foreground line-clamp-3">{source.snippet}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ) : null}

          {result.directoryResults.length > 0 ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-serif text-lg font-semibold text-foreground">
                  Directory ({result.directoryResults.length})
                </h3>
                <Link href={`/search?q=${encodeURIComponent(query)}`} className="text-sm text-primary hover:underline">
                  View all in directory
                </Link>
              </div>
              {result.directoryRows?.length ? (
                <ExpandableDirectoryList
                  items={result.directoryRows.map((row, i) => ({
                    row,
                    explanation: result.directoryResults[i]?.explanation,
                    businessName: row.businessName,
                  }))}
                  query={query}
                />
              ) : result.directoryResults.length > 0 ? (
                <ExpandableDirectoryList
                  items={result.directoryResults.map(
                    (row): DirectoryListItem => ({
                      entityId: row.id,
                      resultSource: row.id.startsWith("sra:") ? "sra" : "curated_listing",
                      businessName: row.title,
                      explanation: row.explanation,
                      subtitle: [row.source, row.locationLabel].filter(Boolean).join(" · "),
                    }),
                  )}
                  query={query}
                />
              ) : null}
            </section>
          ) : null}

          {result.suggestedNextSteps.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Suggested next steps</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {result.suggestedNextSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
