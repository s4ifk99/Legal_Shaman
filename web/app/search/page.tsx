import Link from "next/link";
import { runDirectorySearch } from "@/lib/legal-search/run-directory-search";
import { getDistinctCities, getListingsBySubcategory } from "@/lib/data";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SearchResultLink } from "@/components/search-result-link";
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
import { SearchResultsLayout } from "@/components/search/search-results-layout";
import type { LegacyGetRow } from "@/lib/legal-search/legacy-get-response";
import { enableMapSearch, enableSearchDebug } from "@/lib/legal-search/config";
import { buildMapMarkers } from "@/lib/search/map-results";
import { SearchDebugPanel } from "@/components/search/search-debug-panel";
import { ResultDebugSection } from "@/components/search/result-debug-section";
import { ExternalFallbackSection } from "@/components/triage/external-fallback-section";
import { formatPhoneForDisplay, formatSraCardDescription } from "@/lib/search/sra-display";

type PageProps = {
  searchParams: Promise<{
    q?: string;
    free?: string;
    legalAid?: string;
    city?: string;
    source?: string;
    practiceArea?: string;
    location?: string;
  }>;
};

function matchExplainAdl(sources: ("lexical" | "semantic")[]): string {
  const lex = sources.includes("lexical");
  const sem = sources.includes("semantic");
  if (lex && sem) return "Keywords + similar topic";
  if (sem) return "Similar topic";
  return "Matched keywords";
}

function stableRowKey(row: LegacyGetRow): string {
  if (row.kind === "adlGroup") return `adlg:${row.firmGroupId}`;
  return `adl:${row.id}`;
}

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
    <div className="min-h-screen bg-background">
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
      <div className={`mx-auto px-4 py-10 ${wideLayout ? "max-w-7xl" : "max-w-5xl"}`}>
        <h1 className="mb-2 font-serif text-3xl font-semibold text-primary">Search directory</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Search curated listings, legal aid providers, and SRA organisations. This is not legal advice.
        </p>

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
              <SearchResultsLayout
                markers={mapPayload?.markers ?? []}
                missingCoordinatesCount={mapPayload?.missingCoordinatesCount ?? 0}
              >
                <p className="mb-4 text-sm text-muted-foreground">
                  {rows.length} result{rows.length === 1 ? "" : "s"}
                  {(freeOnly || legalAidOnly || cityFacet) && " · filters applied"}
                </p>
                <ul className="space-y-3">
                  {rows.map((row, index) => {
                    const explanation = explanations[index];
                    const resultDebug = debugByIndex[index];

                    if (row.kind === "adl" && "sourceType" in row && row.sourceType === "sra") {
                      const sraPhone = row.phone?.trim();
                      const sraId = row.id.replace(/^sra:/, "");
                      const sraDescription = formatSraCardDescription(
                        row.description,
                        row.businessName,
                        sraId,
                      );
                      return (
                        <li key={stableRowKey(row)}>
                          <Card className="border-emerald-500/20">
                            <CardContent className="p-4">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <p className="font-semibold text-foreground">{row.businessName}</p>
                                  <Badge variant="outline" className="mt-1 border-emerald-600/40 text-emerald-800">
                                    SRA organisation
                                  </Badge>
                                  {sraPhone ? (
                                    <p className="mt-2 text-sm">
                                      <a
                                        href={`tel:${sraPhone.replace(/\s/g, "")}`}
                                        className="font-medium text-primary hover:underline"
                                      >
                                        {formatPhoneForDisplay(sraPhone)}
                                      </a>
                                    </p>
                                  ) : null}
                                  {sraDescription ? (
                                    <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{sraDescription}</p>
                                  ) : null}
                                  <p className="mt-2 text-xs text-muted-foreground">
                                    {[row.city, row.postcode].filter(Boolean).join(" · ")}
                                  </p>
                                  {explanation ? (
                                    <p className="mt-2 text-xs text-muted-foreground/90">
                                      <span className="font-medium">Why this match: </span>
                                      {explanation}
                                    </p>
                                  ) : null}
                                </div>
                                {row.sraProfileUrl ? (
                                  <SearchResultLink
                                    href={row.sraProfileUrl}
                                    openInNewTab
                                    listingId={row.id}
                                    position={index}
                                    q={q}
                                    resultSource="sra"
                                    parsedPracticeArea={parsedPracticeArea ?? undefined}
                                    parsedLocation={parsedLocation ?? undefined}
                                    clickEventType="website_click"
                                    className="text-sm font-medium text-primary hover:underline"
                                  >
                                    View on SRA register
                                  </SearchResultLink>
                                ) : null}
                              </div>
                              {resultDebug ? <ResultDebugSection debug={resultDebug} /> : null}
                            </CardContent>
                          </Card>
                        </li>
                      );
                    }

                    if (row.kind === "adl") {
                      const listing = row;
                      const sources = listing.sources;
                      return (
                        <li key={stableRowKey(listing)}>
                          <Card className="border-primary/15">
                            <CardContent className="p-4">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <SearchResultLink
                                    href={`/category/${listing.subcategory}`}
                                    className="font-semibold text-foreground hover:underline"
                                    listingId={listing.id}
                                    position={index}
                                    q={q}
                                    parsedPracticeArea={parsedPracticeArea ?? undefined}
                                    parsedLocation={parsedLocation ?? undefined}
                                  >
                                    {listing.businessName}
                                  </SearchResultLink>
                                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                                    {listing.description}
                                  </p>
                                  <p className="mt-2 text-xs text-muted-foreground">
                                    {[listing.city, listing.postcode].filter(Boolean).join(" · ")}
                                  </p>
                                  <p className="mt-1 text-[11px] text-muted-foreground/80">{matchExplainAdl(sources)}</p>
                                  {explanation ? (
                                    <p className="mt-2 text-xs text-muted-foreground/90">
                                      <span className="font-medium">Why this match: </span>
                                      {explanation}
                                    </p>
                                  ) : null}
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {listing.isFree && <Badge className="bg-green-100 text-green-800">Free</Badge>}
                                  {listing.isLegalAid && <Badge variant="secondary">Legal Aid *</Badge>}
                                  {listing.isSponsored && <Badge variant="outline">Sponsored</Badge>}
                                  {sources.includes("semantic") && (
                                    <Badge variant="outline" className="text-xs">
                                      semantic
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              {resultDebug ? <ResultDebugSection debug={resultDebug} /> : null}
                            </CardContent>
                          </Card>
                        </li>
                      );
                    }

                    if (row.kind === "adlGroup") {
                      const rep = row;
                      const sources = rep.sources;
                      return (
                        <li key={stableRowKey(rep)}>
                          <Card className="border-primary/15">
                            <CardContent className="p-4">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="font-semibold text-foreground">{rep.businessName}</p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Legal aid provider · {rep.locations.length} office
                                    {rep.locations.length === 1 ? "" : "s"} (GOV.UK directory)
                                  </p>
                                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{rep.description}</p>
                                  <p className="mt-1 text-[11px] text-muted-foreground/80">{matchExplainAdl(sources)}</p>
                                  {explanation ? (
                                    <p className="mt-2 text-xs text-muted-foreground/90">
                                      <span className="font-medium">Why this match: </span>
                                      {explanation}
                                    </p>
                                  ) : null}
                                  <p className="mt-3 text-xs font-medium text-foreground">Locations</p>
                                  <ul className="mt-2 space-y-3 border-t border-border/60 pt-3">
                                    {rep.locations.map((loc) => {
                                      const l = loc as {
                                        id: string;
                                        city: string;
                                        postcode: string;
                                        subcategory: string;
                                        address?: string;
                                        phone?: string;
                                      };
                                      return (
                                        <li key={l.id} className="text-sm">
                                          <SearchResultLink
                                            href={`/category/${l.subcategory}`}
                                            className="font-medium text-primary hover:underline"
                                            listingId={l.id}
                                            position={index}
                                            q={q}
                                          >
                                            {[l.city, l.postcode].filter(Boolean).join(" · ") || "View office"}
                                          </SearchResultLink>
                                          {l.address ? (
                                            <p className="mt-0.5 text-xs text-muted-foreground">{l.address}</p>
                                          ) : null}
                                          {l.phone ? (
                                            <p className="text-xs text-muted-foreground">
                                              <a href={`tel:${String(l.phone).replace(/\s/g, "")}`} className="hover:underline">
                                                {l.phone}
                                              </a>
                                            </p>
                                          ) : null}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  <Badge variant="secondary">Legal Aid *</Badge>
                                  {rep.isFree && <Badge className="bg-green-100 text-green-800">Free</Badge>}
                                  {rep.isSponsored && <Badge variant="outline">Sponsored</Badge>}
                                  {sources.includes("semantic") && (
                                    <Badge variant="outline" className="text-xs">
                                      semantic
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              {resultDebug ? <ResultDebugSection debug={resultDebug} /> : null}
                            </CardContent>
                          </Card>
                        </li>
                      );
                    }

                    const _exhaustive: never = row;
                    return _exhaustive;
                  })}
                </ul>
                {dir?.externalFallback?.triggered ? (
                  <div className="mt-8">
                    <ExternalFallbackSection payload={dir.externalFallback} />
                  </div>
                ) : null}
                {rows.length === 0 && (
                  <div className="space-y-4">
                    <Card>
                      <CardContent className="py-10 text-center text-muted-foreground">
                        No listings matched your search and filters. Try different words, clear filters, or browse{" "}
                        <Link href="/" className="text-primary underline">
                          categories
                        </Link>
                        .
                      </CardContent>
                    </Card>
                    {citizensFallback.length > 0 && (
                      <Card className="border-green-200/50 bg-green-50/40 dark:bg-green-950/20">
                        <CardContent className="p-4">
                          <p className="mb-2 text-sm font-medium text-foreground">Not sure where to start?</p>
                          <p className="mb-3 text-xs text-muted-foreground">
                            Citizens Advice offers general guidance and signposting (not a substitute for a solicitor).
                          </p>
                          <ul className="space-y-2 text-sm">
                            {citizensFallback.map((l) => (
                              <li key={l.id}>
                                <Link href={`/category/${l.subcategory}`} className="text-primary underline">
                                  {l.businessName}
                                </Link>
                                {l.phone ? <span className="text-muted-foreground"> · {l.phone}</span> : null}
                              </li>
                            ))}
                          </ul>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}
              </SearchResultsLayout>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
