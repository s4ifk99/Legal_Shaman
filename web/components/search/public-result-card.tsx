import type { SearchResult } from "@/lib/legal-search/types";
import {
  contactPageUrlForResult,
  emailForDisplay,
  formatPhoneForDisplay,
  phoneForDisplay,
  publicResultTitle,
  websiteUrlForResult,
} from "@/lib/legal-search/public-search-result";
import { telHref } from "@/lib/search/sra-display";
import { cn } from "@/lib/utils";

type PublicResultCardProps = {
  result: SearchResult;
  selected?: boolean;
  explanation?: string;
  debugSlot?: React.ReactNode;
  /** When true, contact links are omitted (render separately outside expand buttons). */
  hideContactLinks?: boolean;
};

export function PublicResultCard({
  result,
  selected,
  explanation,
  debugSlot,
  hideContactLinks = false,
}: PublicResultCardProps) {
  const title = result.displayName?.trim() || publicResultTitle(result);
  const sourceLabel = result.sourceLabel ?? "Directory listing";
  const locationLabel = result.locationLabel;
  const practiceLine =
    result.practiceAreas.length > 0
      ? `Practice areas: ${result.practiceAreas.slice(0, 4).join(", ")}`
      : null;
  const phone = phoneForDisplay(result);
  const email = emailForDisplay(result);
  const website = websiteUrlForResult(result);
  const contactPage = contactPageUrlForResult(result);
  const whyShown = explanation ?? result.explanation;

  return (
    <article
      data-entity-id={result.id}
      className={cn(
        "rounded-lg border bg-card p-4 shadow-sm transition-colors",
        selected && "border-primary ring-1 ring-primary",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {sourceLabel}
        </span>
      </div>

      {practiceLine ? (
        <p className="mt-2 text-sm text-muted-foreground">{practiceLine}</p>
      ) : null}

      {locationLabel ? (
        <p className="mt-1 text-sm text-muted-foreground">Location: {locationLabel}</p>
      ) : null}

      {phone && !hideContactLinks ? (
        <p className="mt-2 text-sm">
          <span className="text-muted-foreground">Phone: </span>
          <a href={telHref(phone)} className="font-medium text-primary hover:underline">
            {formatPhoneForDisplay(phone)}
          </a>
        </p>
      ) : null}

      {!hideContactLinks ? (
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {website ? (
            <a
              href={website}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary hover:underline"
            >
              Website
            </a>
          ) : null}
          {contactPage ? (
            <a
              href={contactPage}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary hover:underline"
            >
              {website ? "Contact" : contactPage.includes("sra.org.uk") ? "SRA register" : "Contact page"}
            </a>
          ) : null}
          {!phone && !website && !contactPage ? (
            <span className="text-muted-foreground">Contact details not listed</span>
          ) : null}
        </p>
      ) : null}

      {email && !hideContactLinks ? (
        <p className="mt-1 text-sm">
          <a href={`mailto:${email}`} className="text-primary hover:underline">
            {email}
          </a>
        </p>
      ) : null}

      {whyShown ? (
        <p className="mt-3 text-sm leading-relaxed text-foreground/90">
          <span className="font-medium">Why shown: </span>
          {whyShown}
        </p>
      ) : null}

      {debugSlot}
    </article>
  );
}
