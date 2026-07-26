"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, ExternalLink, Loader2, MapPin, MessageCircle, Scale, Search, Sparkles } from "lucide-react";
import { ExpandableDirectoryList } from "@/components/search/expandable-directory-list";
import type { DirectoryListItem } from "@/components/search/expandable-directory-list";
import { SearchCriteriaPanel } from "@/components/legal-search/search-criteria-panel";
import { ShamanRecommends } from "@/components/legal-search/shaman-recommends";
import { OslawPostList } from "@/components/oslaw/post-list";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { LegacyGetRow } from "@/lib/legal-search/legacy-get-response";
import { collapsedDirectorySummary } from "@/lib/search/directory-row-display";
import type { LegalSearchResponse, SearchCriterion } from "@/lib/legal-knowledge/types";
import type { OslawPost } from "@/lib/oslaw/types";
import { useRequireAuth } from "@/lib/auth/use-require-auth";

type OslawSearchResult = {
  id: string;
  title: string;
  url: string;
  subreddit: string;
  score: number;
  comments: number;
  snippet?: string;
  createdUtc?: number;
};

type OslawSearchResponse = {
  results?: OslawSearchResult[];
  source?: "oauth" | "rss" | "public" | "cached";
  degraded?: boolean;
  message?: string;
  error?: string;
};

type AskShamanSearchProps = {
  initialQuery?: string;
  initialLocation?: string;
};

function guidanceConfidenceLabel(score: number): string {
  if (score >= 0.68) return "High confidence";
  if (score >= 0.38) return "Moderate confidence";
  return "Low confidence";
}

function toOslawPost(result: OslawSearchResult): OslawPost {
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

function SectionHeading({
  icon: Icon,
  title,
  count,
  live,
}: {
  icon: typeof BookOpen;
  title: string;
  count?: number;
  live?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="flex items-center gap-2 font-serif text-xl font-semibold text-foreground">
        <Icon className="h-5 w-5 text-gold" />
        {title}
      </h2>
      {typeof count === "number" ? (
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          {count} result{count === 1 ? "" : "s"}
        </span>
      ) : null}
      {live ? (
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          Live
        </span>
      ) : null}
    </div>
  );
}

export function AskShamanSearch({ initialQuery = "", initialLocation = "" }: AskShamanSearchProps) {
  const { openAuthForSearch, loading: authLoading } = useRequireAuth();
  const [query, setQuery] = useState(initialQuery);
  const [location, setLocation] = useState(initialLocation);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [submittedQuery, setSubmittedQuery] = useState("");

  const [guidance, setGuidance] = useState<LegalSearchResponse | null>(null);
  const [guidanceError, setGuidanceError] = useState<string | null>(null);
  const [searchCriteria, setSearchCriteria] = useState<SearchCriterion[]>([]);

  const [oslawPosts, setOslawPosts] = useState<OslawPost[]>([]);
  const [oslawLive, setOslawLive] = useState(false);
  const [oslawNotice, setOslawNotice] = useState<string | null>(null);
  const [oslawError, setOslawError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = initialQuery.trim();
    if (trimmed.length < 2 || authLoading) return;
    void runSearch(trimmed, initialLocation);
  }, [initialQuery, initialLocation, authLoading]);

  async function runSearch(q: string, loc = location) {
    const trimmed = q.trim();
    if (trimmed.length < 2) return;

    setLoading(true);
    setSearched(true);
    setSubmittedQuery(trimmed);
    setGuidanceError(null);
    setOslawError(null);
    setOslawNotice(null);

    const encoded = encodeURIComponent(trimmed);

    const [guidanceRes, oslawRes] = await Promise.allSettled([
      fetch("/api/legal-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: trimmed,
          location: loc.trim() || undefined,
          includeDirectory: true,
        }),
        cache: "no-store",
      }),
      fetch(`/api/oslaw/search?q=${encoded}&limit=10`, { cache: "no-store" }),
    ]);

    if (guidanceRes.status === "fulfilled") {
      if (guidanceRes.value.status === 401) {
        openAuthForSearch(() => void runSearch(trimmed, loc));
        setLoading(false);
        return;
      }
      try {
        const raw = await guidanceRes.value.text();
        let payload: LegalSearchResponse & { error?: string };
        try {
          payload = JSON.parse(raw) as LegalSearchResponse & { error?: string };
        } catch {
          const hint = raw.trim().slice(0, 80);
          throw new Error(
            /timed out|An error o/i.test(hint)
              ? "Search timed out on the server. Try again with a shorter query."
              : `Guidance response was not JSON (${hint || "empty"})`,
          );
        }
        if (!guidanceRes.value.ok) {
          throw new Error(payload.error || "guidance_search_failed");
        }
        setGuidance(payload);
        if (payload.searchCriteria?.length) setSearchCriteria(payload.searchCriteria);
      } catch (err) {
        setGuidance(null);
        setSearchCriteria([]);
        setGuidanceError(err instanceof Error ? err.message : "guidance_search_failed");
      }
    } else {
      setGuidance(null);
      setSearchCriteria([]);
      setGuidanceError("guidance_search_failed");
    }

    if (oslawRes.status === "fulfilled") {
      if (oslawRes.value.status === 401) {
        openAuthForSearch(() => void runSearch(trimmed, loc));
        setLoading(false);
        return;
      }
      try {
        const payload = (await oslawRes.value.json()) as OslawSearchResponse;
        if (!oslawRes.value.ok) {
          throw new Error(payload.message || payload.error || "oslaw_search_failed");
        }
        setOslawPosts((payload.results ?? []).map(toOslawPost));
        setOslawLive(
          payload.source === "oauth" || payload.source === "rss" || payload.source === "public",
        );
        setOslawNotice(payload.degraded && payload.message ? payload.message : null);
      } catch (err) {
        setOslawPosts([]);
        setOslawError(err instanceof Error ? err.message : "oslaw_search_failed");
      }
    } else {
      setOslawPosts([]);
      setOslawError("oslaw_search_failed");
    }

    setLoading(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    const url = new URL(window.location.href);
    url.searchParams.set("q", trimmed);
    if (location.trim()) url.searchParams.set("location", location.trim());
    else url.searchParams.delete("location");
    url.searchParams.delete("tab");
    window.history.replaceState({}, "", url.toString());
    void runSearch(trimmed);
  }

  const guidanceSources = guidance?.sources ?? [];
  const directoryRows = (guidance?.directoryRows ?? []) as LegacyGetRow[];
  const directoryItems: DirectoryListItem[] = guidance?.directoryRows?.length
    ? directoryRows.map((row, i) => ({
        row,
        businessName: row.businessName,
        explanation: guidance.directoryResults[i]?.explanation,
        subtitle: collapsedDirectorySummary(row),
      }))
    : (guidance?.directoryResults ?? []).map((row) => ({
        entityId: row.id,
        resultSource: row.id.startsWith("sra:") ? ("sra" as const) : ("curated_listing" as const),
        businessName: row.title,
        explanation: row.explanation,
        subtitle: [row.source, row.locationLabel].filter(Boolean).join(" · "),
      }));

  const hasAnyResults =
    Boolean(guidance?.answer) ||
    guidanceSources.length > 0 ||
    directoryItems.length > 0 ||
    oslawPosts.length > 0;

  return (
    <div className="space-y-8">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. neighbour injunction, section 21, parking PCN, unfair dismissal…"
            className="h-12 border-gold/30 pl-10 text-base"
            minLength={2}
            required
          />
        </div>
        <Button
          type="submit"
          className="h-12 gap-2 bg-gold px-6 text-gold-foreground hover:bg-gold/90 sm:w-auto"
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Ask
        </Button>
      </form>

      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Optional: city or postcode for lawyer results"
          className="h-10 border-border/70 pl-10"
        />
      </div>

      {(searchCriteria.length > 0 || loading) && searched ? (
        <SearchCriteriaPanel query={submittedQuery || query.trim()} criteria={searchCriteria} loading={loading} />
      ) : null}

      <p className="text-sm text-muted-foreground">
        One search across wiki guidance, solicitors &amp; legal aid, and live UK legal discussions on
        Reddit.
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground">
          Searching guidance, directory, and OSLAW…
        </p>
      ) : null}

      {searched && !loading && !hasAnyResults && !guidanceError && !oslawError ? (
        <p className="text-sm text-muted-foreground">
          No results matched &ldquo;{submittedQuery}&rdquo;. Try different words (e.g.
          &quot;housing repairs&quot;, &quot;redundancy&quot;, &quot;parking PCN&quot;).
        </p>
      ) : null}

      {searched && !loading ? (
        <>
          <section id="wiki" className="space-y-4 scroll-mt-8">
            <SectionHeading
              icon={BookOpen}
              title="Guidance"
              count={guidanceSources.length || undefined}
            />

            {guidanceError ? (
              <p className="text-sm text-destructive">Guidance: {guidanceError}</p>
            ) : null}

            {guidance ? (
              <Card className="border-2 border-gold/30 bg-card">
                <CardContent className="space-y-4 p-5 md:p-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-serif text-lg font-semibold text-primary">Shaman Recommends</h3>
                    {guidance.answerMode === "graph_assembly" ? (
                      <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs font-medium text-sky-800 dark:text-sky-200">
                        Pre-connected guidance
                      </span>
                    ) : guidance.answerMode === "synthesis" ? (
                      <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        AI synthesised
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-200">
                        Source excerpts
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {guidanceConfidenceLabel(guidance.confidence)}
                    </span>
                  </div>

                  <p className="text-xs leading-relaxed text-muted-foreground">{guidance.disclaimer}</p>

                  {guidance.clarifyingQuestion ? (
                    <p className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-foreground">
                      {guidance.clarifyingQuestion}
                    </p>
                  ) : null}

                  {guidance.answer ? (
                    <div className="rounded-xl border border-border/70 bg-muted/30 p-4 md:p-5">
                      <ShamanRecommends
                        answer={guidance.answer}
                        sources={guidance.sources}
                        confidence={guidance.confidence}
                      />
                    </div>
                  ) : null}

                  {guidance.answerMode === "fallback" ? (
                    <p className="text-sm text-muted-foreground">
                      The AI summary could not be generated — showing cited source excerpts instead.
                      On production, check <code className="text-xs">LLM_API_KEY</code> and{" "}
                      <code className="text-xs">LLM_BASE_URL</code> in Vercel env; locally use{" "}
                      <code className="text-xs">.env.local</code>.
                    </p>
                  ) : null}

                  {guidanceSources.length > 0 ? (
                    <section>
                      <h4 className="text-sm font-semibold text-foreground">Sources</h4>
                      <ul className="mt-3 space-y-3">
                        {guidanceSources.map((source, index) => (
                          <li
                            key={`${source.url}-${source.title}`}
                            className="rounded-lg border border-border/60 bg-background/80 p-3"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <p className="text-sm font-medium text-foreground">
                                <span className="mr-2 text-gold">[{index + 1}]</span>
                                {source.title}
                              </p>
                              {source.url ? (
                                <a
                                  href={source.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                >
                                  Open
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{source.source}</p>
                            {source.snippet ? (
                              <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                                {source.snippet}
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </CardContent>
              </Card>
            ) : !guidanceError ? (
              <p className="text-sm text-muted-foreground">
                No curated guidance matched this query.
              </p>
            ) : null}
          </section>

          <section id="lawyers" className="space-y-4 scroll-mt-8">
            <SectionHeading icon={Scale} title="Find a lawyer" count={directoryItems.length} />
            <p className="text-sm text-muted-foreground">
              Solicitors and legal aid providers matched to your issue and practice area — signposting
              only, not endorsements.
            </p>

            {guidanceError ? (
              <p className="text-sm text-destructive">Directory: {guidanceError}</p>
            ) : null}

            {directoryItems.length > 0 ? (
              <ExpandableDirectoryList query={submittedQuery} items={directoryItems} />
            ) : !guidanceError ? (
              <p className="text-sm text-muted-foreground">
                No directory listings matched. Try adding a city or postcode, or use more specific
                words (e.g. &quot;conveyancing solicitor Manchester&quot;).
              </p>
            ) : null}

            <p className="text-sm text-muted-foreground">
              Need a closer match?{" "}
              <Link href="/ask-the-shaman?guided=1" className="font-medium text-primary hover:underline">
                Use guided questions
              </Link>
            </p>
          </section>

          <section id="oslaw" className="space-y-4 scroll-mt-8">
            <SectionHeading
              icon={MessageCircle}
              title="OSLAW"
              count={oslawPosts.length}
              live={oslawLive}
            />
            <p className="text-sm text-muted-foreground">
              Live discussions from UK legal subreddits — signposting only, not legal advice.
            </p>

            {oslawNotice ? (
              <p className="text-sm text-amber-800 dark:text-amber-200">{oslawNotice}</p>
            ) : null}
            {oslawError ? (
              <p className="text-sm text-destructive">OSLAW: {oslawError}</p>
            ) : null}

            {!oslawError ? (
              <OslawPostList
                posts={oslawPosts}
                emptyMessage={`No live Reddit posts matched "${submittedQuery}".`}
              />
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
