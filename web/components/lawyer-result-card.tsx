"use client";

import Link from "next/link";
import { CheckCircle2, MapPin, Languages, Star, Briefcase } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { LawyerMatch } from "@/lib/agent/types";
import { trackSearchEvent } from "@/lib/search-events/client";

type LawyerResultCardProps = {
  match: LawyerMatch;
  selected?: boolean;
  resultRank?: number;
  searchQuery?: string;
  parsedPracticeArea?: string;
  parsedLocation?: string;
  trackEvents?: boolean;
};

export function LawyerResultCard({
  match,
  selected,
  resultRank,
  searchQuery,
  parsedPracticeArea,
  parsedLocation,
  trackEvents = false,
}: LawyerResultCardProps) {
  const track = (eventType: "result_click" | "contact_cta_click" | "website_click") => {
    if (!trackEvents) return;
    trackSearchEvent({
      eventType,
      page: "find_a_lawyer",
      query: searchQuery,
      parsedPracticeArea,
      parsedLocation,
      resultId: match.id,
      resultSource: "lawyer",
      resultRank,
    });
  };
  return (
    <Card
      data-entity-id={match.id}
      className={`overflow-hidden transition-shadow ${selected ? "ring-2 ring-primary" : ""}`}
    >
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <Link
                href={`/lawyers/${match.id}`}
                className="font-serif text-lg font-semibold text-primary hover:underline"
                onClick={() => track("result_click")}
              >
                {match.name}
              </Link>
              {match.verifiedCredentials ? (
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Verified
                </Badge>
              ) : null}
              {match.firmSraVerified ? (
                <Badge
                  variant="outline"
                  className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                  title="Firm appears in the SRA Data Share register"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Firm SRA-verified
                </Badge>
              ) : null}
            </div>
            {match.firm ? (
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <Briefcase className="h-3.5 w-3.5" />
                {match.firmSraProfileUrl ? (
                  <a
                    href={match.firmSraProfileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                    onClick={() => track("website_click")}
                  >
                    {match.firm}
                  </a>
                ) : (
                  match.firm
                )}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
            <span className="font-medium text-foreground">
              {match.rating.toFixed(1)}
            </span>
            <span>({match.reviewCount})</span>
          </div>
        </div>

        <p className="text-sm text-foreground/90">
          <span className="font-medium">Why this match: </span>
          {match.explanation}
        </p>

        <div className="flex flex-wrap gap-1.5">
          {match.practiceAreas.map((p) => (
            <Badge key={p.slug} variant="outline" className="text-xs">
              {p.name}
            </Badge>
          ))}
        </div>

        <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 flex-shrink-0" />
            <span>
              {match.location?.locationLabel || match.city}
              {match.location?.distanceMiles != null
                ? ` · ${match.location.distanceMiles} mi away`
                : match.jurisdiction
                  ? ` · ${match.jurisdiction}`
                  : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Languages className="h-4 w-4 flex-shrink-0" />
            <span>{match.languages.join(", ") || "English"}</span>
          </div>
          <div className="text-xs text-muted-foreground sm:col-span-2">
            {match.yearsExperience > 0
              ? `${match.yearsExperience}+ years experience`
              : "Experience not stated"}
            {match.consultationOptions.length > 0
              ? ` · ${match.consultationOptions.map(formatOption).join(", ")}`
              : ""}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">
              Score breakdown
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px]">
              <span>Practice area</span>
              <span>{match.scoreBreakdown.practiceAreaMatch.toFixed(2)}</span>
              <span>Location</span>
              <span>{match.scoreBreakdown.locationProximity.toFixed(2)}</span>
              <span>Jurisdiction</span>
              <span>{match.scoreBreakdown.jurisdictionMatch.toFixed(2)}</span>
              <span>Language</span>
              <span>{match.scoreBreakdown.languageMatch.toFixed(2)}</span>
              <span>Verified</span>
              <span>{match.scoreBreakdown.verifiedCredentials.toFixed(2)}</span>
              <span>Availability</span>
              <span>{match.scoreBreakdown.availability.toFixed(2)}</span>
              <span>Rating</span>
              <span>{match.scoreBreakdown.rating.toFixed(2)}</span>
              <span>Semantic</span>
              <span>{match.scoreBreakdown.semantic.toFixed(2)}</span>
              <span className="font-semibold">Total</span>
              <span className="font-semibold">{match.scoreBreakdown.total.toFixed(2)}</span>
            </div>
          </details>
          <ContactCta match={match} onContact={() => track("contact_cta_click")} />
        </div>
      </CardContent>
    </Card>
  );
}

function ContactCta({
  match,
  onContact,
}: {
  match: LawyerMatch;
  onContact?: () => void;
}) {
  if (match.profileUrl) {
    return (
      <Button asChild size="sm">
        <a
          href={match.profileUrl}
          target="_blank"
          rel="noreferrer"
          onClick={() => onContact?.()}
        >
          Contact lawyer
        </a>
      </Button>
    );
  }
  return (
    <Button asChild size="sm">
      <Link href={`/lawyers/${match.id}`} onClick={() => onContact?.()}>
        View profile
      </Link>
    </Button>
  );
}

function formatOption(option: string): string {
  switch (option) {
    case "phone":
      return "Phone";
    case "video":
      return "Video";
    case "in_person":
      return "In person";
    case "fixed_fee":
      return "Fixed-fee";
    case "free_consultation":
      return "Free consultation";
    default:
      return option;
  }
}
