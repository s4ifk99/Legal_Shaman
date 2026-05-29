"use client";

import { CheckCircle2, MapPin, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { OrgMatch } from "@/lib/agent/types";
import { formatPhoneForDisplay } from "@/lib/search/sra-display";
import { trackSearchEvent } from "@/lib/search-events/client";

/**
 * Card variant for SRA-registered firms surfaced by the matcher.
 *
 * Distinct from `LawyerResultCard` because:
 *   - We don't have practice areas, languages, ratings, or reviews for orgs.
 *   - The "Verified" claim is grounded in SRA Data Share, not curated review.
 *   - The CTA links **out** to the official SRA consumer profile.
 */
type OrgResultCardProps = {
  match: OrgMatch;
  selected?: boolean;
  resultRank?: number;
  searchQuery?: string;
  parsedPracticeArea?: string;
  parsedLocation?: string;
  trackEvents?: boolean;
};

export function OrgResultCard({
  match,
  selected,
  resultRank,
  searchQuery,
  parsedPracticeArea,
  parsedLocation,
  trackEvents = false,
}: OrgResultCardProps) {
  const track = (eventType: "result_click" | "contact_cta_click" | "website_click" | "phone_click") => {
    if (!trackEvents) return;
    trackSearchEvent({
      eventType,
      page: "find_a_lawyer",
      query: searchQuery,
      parsedPracticeArea,
      parsedLocation,
      resultId: match.id,
      resultSource: "sra",
      resultRank,
    });
  };
  return (
    <Card
      data-entity-id={match.id}
      className={`overflow-hidden transition-shadow ${selected ? "ring-2 ring-primary" : ""}`}
    >
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-serif text-lg font-semibold text-primary">
                {match.businessName}
              </h3>
              <Badge
                variant="outline"
                className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                title="Listed in the SRA Data Share register"
              >
                <CheckCircle2 className="h-3 w-3" />
                SRA Verified
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">SRA-registered firm</p>
          </div>
        </div>

        <p className="text-sm text-foreground/90">
          <span className="font-medium">Why this match: </span>
          {match.explanation}
        </p>

        <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 flex-shrink-0" />
            <span>
              {match.location?.locationLabel ||
                [match.city, match.postcode].filter(Boolean).join(" ") ||
                match.country ||
                "—"}
              {match.location?.distanceMiles != null
                ? ` · ${match.location.distanceMiles} mi away`
                : match.jurisdiction
                  ? ` · ${match.jurisdiction}`
                  : ""}
            </span>
          </div>
          {match.phone?.trim() ? (
            <div className="flex items-center gap-2">
              <a
                href={`tel:${match.phone.replace(/\s/g, "")}`}
                className="font-medium text-primary hover:underline"
                onClick={() => track("phone_click")}
              >
                {formatPhoneForDisplay(match.phone)}
              </a>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">
              Score breakdown
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px]">
              <span>Location</span>
              <span>{match.scoreBreakdown.locationProximity.toFixed(2)}</span>
              <span>Jurisdiction</span>
              <span>{match.scoreBreakdown.jurisdictionMatch.toFixed(2)}</span>
              <span>Verified</span>
              <span>{match.scoreBreakdown.verifiedCredentials.toFixed(2)}</span>
              <span>Semantic</span>
              <span>{match.scoreBreakdown.semantic.toFixed(2)}</span>
              <span className="font-semibold">Total</span>
              <span className="font-semibold">
                {match.scoreBreakdown.total.toFixed(2)}
              </span>
            </div>
          </details>
          <Button asChild size="sm" variant="outline">
            <a
              href={match.sraProfileUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => track("contact_cta_click")}
            >
              View on SRA register
              <ExternalLink className="ml-1 h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
