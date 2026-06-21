"use client";

import { ExternalLink, Globe, Mail, MapPin, Phone } from "lucide-react";
import { SearchResultLink } from "@/components/search-result-link";
import type { LegacyGetRow } from "@/lib/legal-search/legacy-get-response";
import {
  formatPhoneForDisplay,
  parseSraAboutFields,
  telHref,
} from "@/lib/search/sra-display";

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm text-foreground">{children}</div>
    </div>
  );
}

type DirectoryResultDetailProps = {
  row: LegacyGetRow;
  explanation?: string;
  q: string;
  index: number;
  parsedPracticeArea?: string;
  parsedLocation?: string;
};

export function DirectoryResultDetail({
  row,
  explanation,
  q,
  index,
  parsedPracticeArea,
  parsedLocation,
}: DirectoryResultDetailProps) {
  if (row.kind === "adl" && row.sourceType === "sra") {
    const location = [row.city, row.postcode].filter(Boolean).join(", ");
    const website = row.website && !row.website.includes("sra.org.uk") ? row.website : undefined;
    const sraId = row.id.replace(/^sra:/, "");
    const aboutFields = row.description
      ? parseSraAboutFields(row.description, {
          businessName: row.businessName,
          sraId,
          excludePhone: row.phone,
          listedPracticeAreas: row.practiceAreas,
        })
      : [];

    return (
      <div className="grid gap-4 border-t border-border/60 bg-muted/20 p-5 md:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <DetailField label="Practice areas">
            {row.practiceAreas?.length ? row.practiceAreas.join(", ") : "Not listed"}
          </DetailField>
          <DetailField label="Location">{location || "Not listed"}</DetailField>
          <DetailField label="Phone">
            {row.phone?.trim() ? (
              <a href={telHref(row.phone)} className="inline-flex items-center gap-2 text-primary hover:underline">
                <Phone className="h-4 w-4" />
                {formatPhoneForDisplay(row.phone)}
              </a>
            ) : (
              "Not listed"
            )}
          </DetailField>
          <DetailField label="Type">SRA-regulated organisation</DetailField>
        </div>

        {aboutFields.length ? (
          <DetailField label="About">
            <dl className="space-y-3">
              {aboutFields.map(({ label, value }) => (
                <div key={`${label}-${value}`}>
                  <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 text-sm leading-relaxed text-foreground">
                    {label === "Email" ? (
                      <a href={`mailto:${value}`} className="text-primary hover:underline">
                        {value}
                      </a>
                    ) : label === "Website" ? (
                      <a
                        href={value}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {value}
                      </a>
                    ) : label === "Phone" ? (
                      <a href={telHref(value)} className="text-primary hover:underline">
                        {formatPhoneForDisplay(value)}
                      </a>
                    ) : (
                      value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </DetailField>
        ) : null}

        <div className="flex flex-wrap gap-4 text-sm">
          {website ? (
            <SearchResultLink
              href={website}
              openInNewTab
              listingId={row.id}
              position={index}
              q={q}
              resultSource="sra"
              parsedPracticeArea={parsedPracticeArea}
              parsedLocation={parsedLocation}
              clickEventType="website_click"
              className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
            >
              <Globe className="h-4 w-4" />
              Website
              <ExternalLink className="h-3.5 w-3.5" />
            </SearchResultLink>
          ) : null}
          {row.sraProfileUrl ? (
            <SearchResultLink
              href={row.sraProfileUrl}
              openInNewTab
              listingId={row.id}
              position={index}
              q={q}
              resultSource="sra"
              parsedPracticeArea={parsedPracticeArea}
              parsedLocation={parsedLocation}
              clickEventType="website_click"
              className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
            >
              SRA register
              <ExternalLink className="h-3.5 w-3.5" />
            </SearchResultLink>
          ) : null}
        </div>

        {explanation ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Why shown: </span>
            {explanation}
          </p>
        ) : null}
      </div>
    );
  }

  if (row.kind === "adlGroup") {
    return (
      <div className="border-t border-border/60 bg-muted/20 p-5 md:p-6">
        <p className="text-sm leading-relaxed text-muted-foreground">{row.description}</p>
        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">All offices</p>
        <ul className="mt-3 space-y-4">
          {row.locations.map((loc) => {
            const l = loc as {
              id: string;
              city: string;
              postcode: string;
              address?: string;
              phone?: string;
              email?: string;
              website?: string;
              description?: string;
            };
            const address = [l.address, l.city, l.postcode].filter(Boolean).join(", ");
            return (
              <li key={l.id} className="rounded-lg border border-border/60 bg-card p-4">
                <p className="font-medium text-foreground">
                  {[l.city, l.postcode].filter(Boolean).join(" · ") || "Office"}
                </p>
                {address ? (
                  <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                    {address}
                  </p>
                ) : null}
                {l.phone ? (
                  <a
                    href={`tel:${l.phone.replace(/\s/g, "")}`}
                    className="mt-2 inline-flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Phone className="h-4 w-4" />
                    {l.phone}
                  </a>
                ) : null}
                {l.email ? (
                  <a
                    href={`mailto:${l.email}`}
                    className="mt-2 inline-flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Mail className="h-4 w-4" />
                    {l.email}
                  </a>
                ) : null}
                {l.description ? (
                  <p className="mt-2 text-sm text-muted-foreground">{l.description}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
        {explanation ? (
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Why shown: </span>
            {explanation}
          </p>
        ) : null}
      </div>
    );
  }

  if (row.kind === "adl") {
    const location = [row.city, row.postcode].filter(Boolean).join(", ");

    return (
      <div className="grid gap-4 border-t border-border/60 bg-muted/20 p-5 md:p-6">
        <p className="text-sm leading-relaxed text-muted-foreground">{row.description}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <DetailField label="Category">{row.category}</DetailField>
          <DetailField label="Specialism">{row.subcategory.replace(/-/g, " ")}</DetailField>
          <DetailField label="Location">
            {location ? (
              <span className="inline-flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                {location}
              </span>
            ) : (
              "Not listed"
            )}
          </DetailField>
          <DetailField label="Phone">
            {row.phone?.trim() ? (
              <a href={`tel:${row.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-2 text-primary hover:underline">
                <Phone className="h-4 w-4" />
                {row.phone}
              </a>
            ) : (
              "Not listed"
            )}
          </DetailField>
          <DetailField label="Email">
            {row.email?.trim() ? (
              <a href={`mailto:${row.email}`} className="inline-flex items-center gap-2 text-primary hover:underline">
                <Mail className="h-4 w-4" />
                {row.email}
              </a>
            ) : (
              "Not listed"
            )}
          </DetailField>
        </div>

        {row.website ? (
          <a
            href={row.website}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <Globe className="h-4 w-4" />
            Visit website
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}

        {explanation ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Why shown: </span>
            {explanation}
          </p>
        ) : null}
      </div>
    );
  }

  return null;
}
