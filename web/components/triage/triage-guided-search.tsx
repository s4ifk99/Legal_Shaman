"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { DisclaimerBanner } from "@/components/disclaimer-banner";
import { LawyerFiltersSidebar } from "@/components/lawyer-filters-sidebar";
import { SearchResultsLayout } from "@/components/search/search-results-layout";
import { SearchDebugPanel } from "@/components/search/search-debug-panel";
import { TriageQuestionCard } from "@/components/triage/triage-question-card";
import { TriageResultsSections } from "@/components/triage/triage-results-sections";
import { ExternalFallbackSection } from "@/components/triage/external-fallback-section";
import { TriageUrgentBanner } from "@/components/triage/triage-urgent-banner";
import type { AppliedFilters } from "@/lib/agent/types";
import type { MapMarker } from "@/lib/search/map-results";
import type {
  TriageQuestion,
  TriageResponse,
  TriageResultsResponse,
  TriageState,
} from "@/lib/legal-search/triage/types";
import type { SearchResponseDebug } from "@/lib/legal-search/search-diagnostics-types";
import type { SearchResult } from "@/lib/legal-search/types";

type TriageUiState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "question"; question: TriageQuestion; triageState: TriageState; searchDebug?: SearchResponseDebug }
  | { kind: "results"; payload: TriageResultsResponse }
  | { kind: "error"; message: string };

const EXAMPLE_QUERIES = [
  "I need a prison lawyer and have no money",
  "I lost my job and can't afford a solicitor",
  "I need help with eviction tonight",
  "My visa was refused, legal aid?",
];

function markersToMapMarkers(
  markers: TriageResultsResponse["markers"],
  results: SearchResult[],
): MapMarker[] {
  const byId = new Map(results.map((r) => [r.id, r]));
  return markers.map((m) => {
    const r = byId.get(m.id);
    const raw = r?.raw as { entityType?: string } | undefined;
    return {
      id: m.id,
      entityId: m.id,
      entityType: raw?.entityType ?? r?.source ?? "listing",
      title: m.title,
      practiceAreas: r?.practiceAreas ?? [],
      city: r?.location?.city,
      postcode: r?.location?.postcode,
      lat: m.lat,
      lng: m.lng,
      source: r?.source ?? "curated_listing",
      url: r?.url ?? r?.contact?.website,
      explanation: r?.explanation,
    };
  });
}

type TriageGuidedSearchProps = {
  mapEnabled?: boolean;
  debugEnabled?: boolean;
};

export function TriageGuidedSearch({
  mapEnabled = true,
  debugEnabled = false,
}: TriageGuidedSearchProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<TriageUiState>({ kind: "idle" });
  const [filters, setFilters] = useState<AppliedFilters>({});

  const sessionId = useMemo(
    () =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s-${Math.random().toString(36).slice(2)}`,
    [],
  );

  const postTriage = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch("/api/search/triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, sessionId }),
    });
    const data = (await res.json()) as TriageResponse & { error?: string };
    if (!res.ok) throw new Error(data.error || "Triage request failed");
    return data;
  }, [sessionId]);

  const startTriage = useCallback(
    async (q: string) => {
      setStatus({ kind: "loading" });
      try {
        const data = await postTriage({ action: "start", query: q });
        applyResponse(data);
      } catch (err) {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [postTriage],
  );

  const applyResponse = useCallback(
    (data: TriageResponse) => {
      if (data.kind === "triage_question") {
        setStatus({
          kind: "question",
          question: data.question,
          triageState: data.triageState,
          searchDebug: debugEnabled ? data.searchDebug : undefined,
        });
      } else {
        setQuery(data.triageState.mergedQuery || data.triageState.initialQuery);
        setStatus({ kind: "results", payload: data });
      }
    },
    [debugEnabled],
  );

  const submitTriageAnswer = useCallback(
    async (
      triageState: TriageState,
      field: TriageQuestion["field"],
      value: string,
    ) => {
      setStatus({ kind: "loading" });
      try {
        const data = await postTriage({
          action: "answer",
          state: triageState,
          field,
          value,
        });
        applyResponse(data);
      } catch (err) {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [postTriage, applyResponse],
  );

  const skipTriageField = useCallback(
    async (triageState: TriageState, field: TriageQuestion["field"]) => {
      setStatus({ kind: "loading" });
      try {
        const data = await postTriage({ action: "skip", state: triageState, field });
        applyResponse(data);
      } catch (err) {
        setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    },
    [postTriage, applyResponse],
  );

  const answerQuestion = useCallback(
    async (value: string) => {
      if (status.kind !== "question") return;
      await submitTriageAnswer(status.triageState, status.question.field, value);
    },
    [status, submitTriageAnswer],
  );

  const skipQuestion = useCallback(async () => {
    if (status.kind !== "question") return;
    await skipTriageField(status.triageState, status.question.field);
  }, [status, skipTriageField]);

  const startOver = useCallback(async () => {
    setQuery("");
    setStatus({ kind: "idle" });
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    startTriage(q);
  };

  const isLoading = status.kind === "loading";

  const allResults =
    status.kind === "results"
      ? status.payload.sections.flatMap((s) => s.results)
      : [];

  const mapMarkers =
    status.kind === "results"
      ? markersToMapMarkers(status.payload.markers, allResults)
      : [];

  const showMap = mapEnabled && status.kind === "results" && mapMarkers.length > 0;

  const resultsBlock =
    status.kind === "results" ? (
      <div className="space-y-4">
        {status.payload.urgentSignposting ? (
          <TriageUrgentBanner signposting={status.payload.urgentSignposting} />
        ) : null}
        {status.payload.coverageNotice ? (
          <Card className="border-amber-200/70 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/25">
            <CardContent className="p-3 text-sm leading-relaxed text-foreground">
              {status.payload.coverageNotice}
            </CardContent>
          </Card>
        ) : null}
        {status.payload.degradedModes.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Note: some data sources may be limited ({status.payload.degradedModes.join(", ")}).
          </p>
        ) : null}
        {status.payload.nextQuestion ? (
          <TriageQuestionCard
            question={status.payload.nextQuestion}
            loading={isLoading}
            onAnswer={(v) =>
              submitTriageAnswer(
                status.payload.triageState,
                status.payload.nextQuestion!.field,
                v,
              )
            }
            onSkip={
              status.payload.nextQuestion.allowSkip
                ? () =>
                    skipTriageField(
                      status.payload.triageState,
                      status.payload.nextQuestion!.field,
                    )
                : undefined
            }
          />
        ) : null}
        <TriageResultsSections
          sections={status.payload.sections}
          legacyRowByResultId={status.payload.legacyRowByResultId}
          query={status.payload.triageState.mergedQuery}
          parsedPracticeArea={status.payload.parsedQuery.practiceAreaSlug ?? undefined}
          parsedLocation={status.payload.parsedQuery.location ?? undefined}
        />
        {status.payload.externalFallback ? (
          <ExternalFallbackSection payload={status.payload.externalFallback} />
        ) : null}
      </div>
    ) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="order-2 lg:order-1">
        <LawyerFiltersSidebar value={filters} onChange={setFilters} disabled={isLoading} />
      </aside>

      <div className="order-1 space-y-6 lg:order-2">
        <DisclaimerBanner />
        <p className="text-xs text-muted-foreground">{status.kind === "results" ? status.payload.disclaimer : "Guided search for signposting only — not legal advice."}</p>

        <form onSubmit={onSubmit} className="space-y-3">
          <label htmlFor="triage-query" className="block text-sm font-medium">
            What legal problem do you need help with?
          </label>
          <Textarea
            id="triage-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. I was unfairly dismissed and need legal aid advice in Manchester"
            rows={3}
            disabled={isLoading}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={isLoading || query.trim().length < 2}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Working…
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" />
                  Start guided search
                </>
              )}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={startOver}>
              <RotateCcw className="mr-1 h-3 w-3" />
              Start over
            </Button>
            {EXAMPLE_QUERIES.map((ex) => (
              <button
                type="button"
                key={ex}
                onClick={() => {
                  setQuery(ex);
                  startTriage(ex);
                }}
                disabled={isLoading}
                className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
              >
                {ex}
              </button>
            ))}
          </div>
        </form>

        {status.kind === "question" ? (
          <TriageQuestionCard
            question={status.question}
            loading={isLoading}
            onAnswer={answerQuestion}
            onSkip={status.question.allowSkip ? skipQuestion : undefined}
          />
        ) : null}

        {status.kind === "error" ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {status.message}
          </div>
        ) : null}

        {status.kind === "results" && debugEnabled && status.payload.searchDebug ? (
          <SearchDebugPanel searchDebug={status.payload.searchDebug} />
        ) : null}

        {status.kind === "results" ? (
          showMap ? (
            <SearchResultsLayout
              markers={mapMarkers}
              missingCoordinatesCount={allResults.length - mapMarkers.length}
            >
              {resultsBlock}
            </SearchResultsLayout>
          ) : (
            resultsBlock
          )
        ) : null}
      </div>
    </div>
  );
}
