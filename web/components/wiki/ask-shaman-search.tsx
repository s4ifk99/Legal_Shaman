"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Search, Sparkles } from "lucide-react";
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

type WikiAnswerFirm = {
  firm: string;
  practiceArea: string;
  articleCount: number;
  directoryUrl: string;
};

type WikiAnswerSource = {
  name: string;
  detail?: string;
};

type WikiAnswerResponse = {
  query: string;
  mode: "synthesis" | "retrieval_only" | "insufficient";
  answer: string | null;
  wikiPages: WikiSearchHit[];
  sources: WikiAnswerSource[];
  recommendedFirms: WikiAnswerFirm[];
  disclaimer: string;
  retrievalScore: number;
  message?: string;
};

type AskShamanSearchProps = {
  initialQuery?: string;
};

function renderAnswerParagraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => (
      <p key={block.slice(0, 48)} className="text-sm leading-relaxed text-foreground">
        {block}
      </p>
    ));
}

export function AskShamanSearch({ initialQuery = "" }: AskShamanSearchProps) {
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<WikiAnswerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    setError(null);

    try {
      const res = await fetch("/api/ask/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
        cache: "no-store",
      });
      const payload = (await res.json()) as WikiAnswerResponse & { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || "answer_request_failed");
      }
      setAnswer(payload);
    } catch (err) {
      setAnswer(null);
      setError(err instanceof Error ? err.message : "answer_request_failed");
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

  const wikiPages = answer?.wikiPages ?? [];

  return (
    <div className="space-y-6">
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
          className="h-12 gap-2 bg-gold px-6 text-gold-foreground hover:bg-gold/90"
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Ask
        </Button>
      </form>

      {loading ? (
        <p className="text-sm text-muted-foreground">Searching the wiki and preparing a signposting summary…</p>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive">Could not load an answer: {error}</p>
      ) : null}

      {!loading && answer ? (
        <Card className="border-2 border-gold/30 bg-card">
          <CardContent className="space-y-4 p-5 md:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-serif text-xl font-semibold text-foreground">Signposting summary</h2>
              {answer.mode === "synthesis" ? (
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  Wiki-grounded
                </span>
              ) : null}
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">{answer.disclaimer}</p>

            {answer.message ? (
              <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">{answer.message}</p>
            ) : null}

            {answer.answer ? (
              <div className="space-y-3 rounded-xl border border-border/70 bg-muted/30 p-4">
                {renderAnswerParagraphs(answer.answer)}
              </div>
            ) : null}

            {answer.recommendedFirms.length > 0 ? (
              <section>
                <h3 className="text-sm font-semibold text-foreground">Firms with indexed commentary</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Signposting only — not endorsements. These firms have multiple wiki articles on related topics.
                </p>
                <ul className="mt-3 space-y-2">
                  {answer.recommendedFirms.map((firm) => (
                    <li key={firm.firm} className="text-sm">
                      <Link
                        href={firm.directoryUrl}
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        {firm.firm}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                      <span className="text-muted-foreground">
                        {" "}
                        · {firm.practiceArea} · {firm.articleCount} articles
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {answer.sources.length > 0 ? (
              <section>
                <h3 className="text-sm font-semibold text-foreground">Source documents</h3>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {answer.sources.map((source) => (
                    <li key={source.name}>• {source.name}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <p className="text-sm text-muted-foreground">
              Need a solicitor?{" "}
              <Link href="/search" className="font-medium text-primary hover:underline">
                Find a Lawyer
              </Link>
            </p>
          </CardContent>
        </Card>
      ) : null}

      {!loading && searched && wikiPages.length === 0 && !answer?.message && answer?.mode !== "insufficient" ? (
        <p className="text-sm text-muted-foreground">
          No wiki pages matched your question. Try different words (e.g. &quot;housing repairs&quot;,
          &quot;redundancy&quot;).
        </p>
      ) : null}

      {wikiPages.length > 0 ? (
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground">Relevant wiki pages</h2>
          <p className="mt-1 text-sm text-muted-foreground">Read the source-grounded guidance behind this summary.</p>
          <ul className="mt-4 space-y-4">
            {wikiPages.map((hit) => (
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
        </section>
      ) : null}
    </div>
  );
}
