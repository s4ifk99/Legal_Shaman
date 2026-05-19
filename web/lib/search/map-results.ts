import type { AnyMatch } from "@/lib/agent/types";
import { isValidUkCoordinate } from "@/lib/search/location";
import type { SearchResult } from "@/lib/legal-search/types";
import type { LatLng, MapBounds } from "@/lib/search/location";
import { distanceMiles, pointInBounds } from "@/lib/search/location";

export type MapMarker = {
  id: string;
  entityId: string;
  entityType: string;
  title: string;
  subtitle?: string;
  practiceAreas: string[];
  address?: string;
  city?: string;
  postcode?: string;
  lat: number;
  lng: number;
  source: string;
  verified?: boolean;
  legalAid?: boolean;
  url?: string;
  explanation?: string;
};

export type MapSearchPayload = {
  results: SearchResult[];
  markers: MapMarker[];
  missingCoordinatesCount: number;
  bounds?: MapBounds;
};

export function buildMapMarkers(
  results: SearchResult[],
  options?: { bounds?: MapBounds; origin?: LatLng },
): MapSearchPayload {
  const markers: MapMarker[] = [];
  let missing = 0;

  for (const r of results) {
    const lat = r.location?.lat;
    const lng = r.location?.lng;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      missing++;
      continue;
    }
    if (options?.bounds && !pointInBounds({ lat, lng }, options.bounds)) continue;

    const entityType =
      r.source === "sra"
        ? "sra_organisation"
        : r.source === "legal_aid"
          ? "legal_aid_provider"
          : r.source === "lawyer"
            ? "lawyer"
            : r.source === "firm"
              ? "firm"
              : "curated_listing";

    markers.push({
      id: `m:${r.id}`,
      entityId: r.id,
      entityType,
      title: r.title,
      subtitle: r.practiceAreas[0],
      practiceAreas: r.practiceAreas,
      address: r.location?.city,
      city: r.location?.city,
      postcode: r.location?.postcode,
      lat,
      lng,
      source: r.source,
      verified: r.verified,
      legalAid: r.source === "legal_aid",
      url: r.url,
      explanation: r.explanation,
    });
  }

  if (options?.origin) {
    for (const m of markers) {
      const d = distanceMiles(options.origin, { lat: m.lat, lng: m.lng });
      m.subtitle = m.subtitle ? `${m.subtitle} · ${d.toFixed(1)} mi` : `${d.toFixed(1)} mi away`;
    }
  }

  return { results, markers, missingCoordinatesCount: missing, bounds: options?.bounds };
}

export function countMissingMatcherCoordinates(matches: AnyMatch[]): number {
  return matches.filter((m) => !m.mapMarker).length;
}

export function buildMatcherMapMarkers(matches: AnyMatch[]): MapMarker[] {
  const markers: MapMarker[] = [];
  for (const m of matches) {
    if (!m.mapMarker) continue;
    const { lat, lng } = m.mapMarker;
    if (!isValidUkCoordinate(lat, lng)) continue;
    markers.push(m.mapMarker);
  }
  return markers;
}

const BOUNDS_PAD = 0.02;

export function boundsFromMarkers(markers: MapMarker[]): MapBounds | undefined {
  if (!markers.length) return undefined;
  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;
  for (const m of markers) {
    north = Math.max(north, m.lat);
    south = Math.min(south, m.lat);
    east = Math.max(east, m.lng);
    west = Math.min(west, m.lng);
  }
  return {
    north: north + BOUNDS_PAD,
    south: south - BOUNDS_PAD,
    east: east + BOUNDS_PAD,
    west: west - BOUNDS_PAD,
  };
}
