"use client";

import Link from "next/link";
import type { MapMarker } from "@/lib/search/map-results";
import { formatPhoneForDisplay } from "@/lib/search/sra-display";
import { searchUrlForEntity } from "@/lib/search/result-navigation";

type MapMarkerPopupProps = {
  marker: MapMarker;
};

export function MapMarkerPopup({ marker }: MapMarkerPopupProps) {
  const title = marker.displayName ?? marker.title;
  return (
    <div className="text-sm">
      <p className="font-semibold">{title}</p>
      {marker.sourceLabel ? (
        <p className="text-xs text-muted-foreground">{marker.sourceLabel}</p>
      ) : marker.subtitle ? (
        <p className="text-muted-foreground">{marker.subtitle}</p>
      ) : null}
      {marker.city || marker.postcode ? (
        <p className="text-xs">{[marker.city, marker.postcode].filter(Boolean).join(", ")}</p>
      ) : null}
      {marker.phone ? (
        <p className="mt-1">
          <a href={`tel:${marker.phone.replace(/\s/g, "")}`} className="text-primary underline">
            {formatPhoneForDisplay(marker.phone)}
          </a>
        </p>
      ) : null}
      <p className="mt-1 flex flex-wrap gap-2 text-xs">
        <Link
          href={searchUrlForEntity(marker.entityId, title)}
          className="font-medium text-primary underline"
        >
          Full details
        </Link>
        {marker.website ? (
          <a href={marker.website} className="text-primary underline" target="_blank" rel="noreferrer">
            Website
          </a>
        ) : null}
        {marker.contactPageUrl ? (
          <a
            href={marker.contactPageUrl}
            className="text-primary underline"
            target="_blank"
            rel="noreferrer"
          >
            Contact
          </a>
        ) : marker.url ? (
          <a href={marker.url} className="text-primary underline" target="_blank" rel="noreferrer">
            View
          </a>
        ) : null}
      </p>
    </div>
  );
}
