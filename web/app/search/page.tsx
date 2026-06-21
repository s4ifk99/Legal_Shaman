import { runDirectorySearch } from "@/lib/legal-search/run-directory-search";
import { getDistinctCities, getListingsBySubcategory } from "@/lib/data";
import { Card, CardContent } from "@/components/ui/card";
import {
  DirectorySearchTracking,
  type DirectoryImpressionRow,
} from "@/components/search/directory-search-tracking";
import {
  RefinementChips,
  RefinementPromptTracked,
} from "@/components/search/refinement-prompt-tracked";
import { SearchFormWithSuggestions } from "@/components/search-form-with-suggestions";
import { SearchDirectorySidebar } from "@/components/search-directory-sidebar";
import { DirectorySearchResults } from "@/components/search/directory-search-results";
import { RedditResults } from "@/components/search/reddit-results";
import Link from "next/link";
import { Bookmark } from "lucide-react";
import type { LegacyGetRow } from "@/lib/legal-search/legacy-get-response";
import { enableMapSearch, enableSearchDebug } from "@/lib/legal-search/config";
import { buildMapMarkers } from "@/lib/search/map-results";
import { SearchDebugPanel } from "@/components/search/search-debug-panel";
import { OslawTrendingMarquee } from "@/components/oslaw/trending-marquee";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

type PageProps = {
  searchParams: Promise<{
    q?: string;
    free?: string;
    legalAid?: string;
    city?: string;
    source?: string;
    reddit?: string;
    practiceArea?: string;
    location?: string;
  }>;
};

function impressionRowsFromLegacy(rows: LegacyGetRow[]): DirectoryImpressionRow[] {
  return rows.map((row) => {
    if (row.kind === "adlGroup") {
      return { resultId: row.firmGroupId, resultSource: "legal_aid" as const };
    }
    if (row.kind === "adl" && "sourceType" in row && row.sourceType === "sra") {
      return { resultId: row.id, resultSource: "sra" as const };
    }
    return { resultId: row.id, resultSource: "curated_listing" as const };
  });
}

export default async function SearchPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const q = (sp.q || "").trim();
  const freeOnly = sp.free === "1";
  const legalAidOnly = sp.legalAid === "1";
  const cityFacet = (sp.city || "").trim();
  const source = sp.source?.trim();
  const redditEnabled = sp.reddit === "1";
  const practiceArea = sp.practiceArea?.trim();
  const location = sp.location?.trim();

  const cities = getDistinctCities({ max: 32 });

  const dir =
    q.length >= 2
      ? await runDirectorySearch({
          query: q,
          limit: 60,
          semantic: false,
          freeOnly,
          legalAidOnly,
          city: cityFacet,
          source,
          practiceArea,
          location,
        })
      : null;

  const rows: LegacyGetRow[] = (dir?.legacyRows ?? []) as LegacyGetRow[];
  const explanations = dir?.results.map((r) => r.explanation) ?? [];
  const debugByIndex = dir?.results.map((r) => r.debug) ?? [];
  const showSearchDebug = enableSearchDebug() && Boolean(dir?.searchDebug);
  const parsedPracticeArea = dir?.parsedQuery?.practiceAreaSlug ?? practiceArea;
  const parsedLocation = dir?.parsedQuery?.location ?? location ?? cityFacet;

  const citizensFallback = getListingsBySubcategory("citizens-advice").slice(0, 3);
  const mapPayload = dir && enableMapSearch() ? buildMapMarkers(dir.results) : null;
  const wideLayout = Boolean(mapPayload?.markers.length);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <OslawTrendingMarquee />
      {q.length >= 2 ? (
        <DirectorySearchTracking
          searchKey={`${q}|${freeOnly}|${legalAidOnly}|${cityFacet}|${source ?? ""}|${practiceArea ?? ""}`}
          q={q}
          resultCount={rows.length}
          rows={impressionRowsFromLegacy(rows)}
          parsedPracticeArea={(dir?.parsedQuery?.practiceAreaSlug ?? practiceArea) ?? undefined}
          parsedLocation={(dir?.parsedQuery?.location ?? location ?? cityFacet) ?? undefined}
          freeOnly={freeOnly}
          legalAidOnly={legalAidOnly}
          city={cityFacet || undefined}
        />
      ) : null}
      <div className={`mx-auto flex-1 px-4 py-10 ${wideLayout ? "max-w-7xl" : "max-w-5xl"}`}>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="mb-2 font-serif text-3xl font-semibold text-primary">Search directory</h1>
            <p className="text-sm text-muted-foreground">
              Search curated listings, legal aid providers, and SRA organisations. This is not legal advice.
            </p>
          </div>
          <Link
            href="/bookmarks"
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
          >
            <Bookmark className="h-4 w-4" />
            Bookmarks
          </Link>
        </div>

        <RedditResults query={q} enabled={redditEnabled} />

        <SearchFormWithSuggestions
          key={`${q}|${freeOnly}|${legalAidOnly}|${cityFacet}`}
          initialQuery={q}
          initialFreeOnly={freeOnly}
          initialLegalAidOnly={legalAidOnly}
          initialCity={cityFacet}
          cities={cities}
        />

        <div className="mt-8 grid gap-8 lg:grid-cols-[260px_1fr]">
          <SearchDirectorySidebar
            q={q}
            freeOnly={freeOnly}
            legalAidOnly={legalAidOnly}
            city={cityFacet}
            source={source}
            practiceArea={practiceArea}
          />

          <div>
            {q.length >= 2 &&
            dir?.parsedQuery?.queryConfidence === "medium" &&
            dir.parsedQuery.taxonomySummary ? (
              <Card className="mb-4 border-sky-200/70 bg-sky-50/50 dark:border-sky-900/40 dark:bg-sky-950/25">
                <CardContent className="p-3 text-sm leading-relaxed text-foreground">
                  {dir.parsedQuery.taxonomySummary}
                  {dir.vagueRescueNotice ? (
                    <p className="mt-2 text-muted-foreground">{dir.vagueRescueNotice}</p>
                  ) : null}
                  {dir.parsedQuery.refinementChips?.length ? (
                    <RefinementChips
                      baseQuery={q}
                      chips={dir.parsedQuery.refinementChips}
                      parsedPracticeArea={parsedPracticeArea ?? undefined}
                      parsedLocation={parsedLocation ?? undefined}
                      freeOnly={freeOnly}
                      legalAidOnly={legalAidOnly}
                      city={cityFacet || undefined}
                    />
                  ) : dir.parsedQuery.refinementQuestion ? (
                    <RefinementPromptTracked
                      q={q}
                      question={dir.parsedQuery.refinementQuestion}
                      parsedPracticeArea={parsedPracticeArea ?? undefined}
                      parsedLocation={parsedLocation ?? undefined}
                    />
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
            {q.length > 0 && q.length < 2 && (
              <p className="text-sm text-muted-foreground">Enter at least 2 characters to search.</p>
            )}

            {dir?.coverageNotice ? (
              <Card className="mb-4 border-amber-200/70 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/25">
                <CardContent className="p-3 text-sm leading-relaxed text-foreground">
                  {dir.coverageNotice}
                </CardContent>
              </Card>
            ) : null}

            {showSearchDebug && dir?.searchDebug ? (
              <div className="mb-4">
                <SearchDebugPanel searchDebug={dir.searchDebug} />
              </div>
            ) : null}
            {q.length >= 2 && (
              <DirectorySearchResults
                rows={rows}
                explanations={explanations}
                debugByIndex={debugByIndex}
                q={q}
                parsedPracticeArea={parsedPracticeArea ?? undefined}
                parsedLocation={parsedLocation ?? undefined}
                freeOnly={freeOnly}
                legalAidOnly={legalAidOnly}
                cityFacet={cityFacet}
                markers={mapPayload?.markers ?? []}
                missingCoordinatesCount={mapPayload?.missingCoordinatesCount ?? 0}
                externalFallback={dir?.externalFallback ?? null}
                citizensFallback={citizensFallback}
              />
            )}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
