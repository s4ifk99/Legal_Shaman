"use client";

import type { MapMarker } from "@/lib/search/map-results";

type MapMarkerPopupProps = {
  marker: MapMarker;
};

export function MapMarkerPopup({ marker }: MapMarkerPopupProps) {
  return (
    <div className="text-sm">
      <p className="font-semibold">{marker.title}</p>
      {marker.subtitle ? <p className="text-muted-foreground">{marker.subtitle}</p> : null}
      {marker.city || marker.postcode ? (
        <p className="text-xs">{[marker.city, marker.postcode].filter(Boolean).join(" ")}</p>
      ) : null}
      {marker.url ? (
        <a
          href={marker.url}
          className="mt-1 inline-block text-xs text-primary underline"
          target="_blank"
          rel="noreferrer"
        >
          View
        </a>
      ) : null}
    </div>
  );
}
