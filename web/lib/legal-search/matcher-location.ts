import "server-only";

import { prisma } from "@/lib/db/prisma";
import type { MatchLocation } from "@/lib/agent/types";
import type { MapMarker } from "@/lib/search/map-results";
import { enableGeocodingRuntime } from "@/lib/legal-search/config";
import { lookupGeocodedCache } from "@/lib/search-index/geocode";
import { geocodeUkLocation } from "@/lib/search/geocoding-provider";
import { geocodeCacheKey } from "@/lib/search-index/normalise-address";
import type { RankedCandidate } from "@/lib/lawyers/rank";
import type { ExtractedFilters } from "@/lib/agent/types";
import type { LatLng } from "@/lib/search/location";
import { distanceMiles, isValidUkCoordinate } from "@/lib/search/location";

export { isValidUkCoordinate };

type ResolvedCoords = {
  lat: number;
  lng: number;
  address?: string;
  city: string;
  postcode: string;
};

function locationLabel(city: string, postcode: string): string {
  return [city, postcode].map((s) => s.trim()).filter(Boolean).join(", ");
}

async function resolveCoordsFromParts(parts: {
  postcode?: string;
  city?: string;
  address?: string;
  existingLat?: number | null;
  existingLng?: number | null;
  normalizedAddress?: string | null;
}): Promise<ResolvedCoords | null> {
  const city = (parts.city ?? "").trim();
  const postcode = (parts.postcode ?? "").trim();

  if (
    parts.existingLat != null &&
    parts.existingLng != null &&
    isValidUkCoordinate(parts.existingLat, parts.existingLng)
  ) {
    return {
      lat: parts.existingLat,
      lng: parts.existingLng,
      address: parts.normalizedAddress?.trim() || parts.address?.trim() || undefined,
      city,
      postcode,
    };
  }

  const cached = await lookupGeocodedCache({
    postcode: parts.postcode,
    city: parts.city,
    address: parts.address,
  });
  if (cached && isValidUkCoordinate(cached.latitude, cached.longitude)) {
    return {
      lat: cached.latitude,
      lng: cached.longitude,
      address: cached.address,
      city: cached.city ?? city,
      postcode: cached.postcode ?? postcode,
    };
  }

  if (!enableGeocodingRuntime()) return null;

  const result = await geocodeUkLocation({
    postcode: parts.postcode,
    city: parts.city,
    address: parts.address,
  });
  if (!result || !isValidUkCoordinate(result.latitude, result.longitude)) return null;

  const key = geocodeCacheKey(parts);
  if (key) {
    try {
      await prisma.geocodedLocation.upsert({
        where: { normalizedInput: key },
        create: {
          input: key,
          normalizedInput: key,
          address: result.address,
          postcode: result.postcode ?? parts.postcode,
          city: result.city ?? parts.city,
          latitude: result.latitude,
          longitude: result.longitude,
          provider: result.provider,
          confidence: result.confidence,
        },
        update: {
          latitude: result.latitude,
          longitude: result.longitude,
          provider: result.provider,
          confidence: result.confidence,
          updatedAt: new Date(),
        },
      });
    } catch {
      // ignore cache write failures
    }
  }

  return {
    lat: result.latitude,
    lng: result.longitude,
    address: result.address,
    city: result.city ?? city,
    postcode: result.postcode ?? postcode,
  };
}

/** Origin for distance labels — cache lookup on query city/postcode only. */
export async function resolveMatcherSearchOrigin(
  extracted: ExtractedFilters,
): Promise<LatLng | undefined> {
  const coords = await resolveCoordsFromParts({
    city: extracted.city ?? undefined,
    postcode: extracted.postcode ?? undefined,
  });
  if (!coords) return undefined;
  return { lat: coords.lat, lng: coords.lng };
}

async function resolveLawyerCoords(
  r: Extract<RankedCandidate, { kind: "lawyer" }>,
): Promise<ResolvedCoords | null> {
  const loc = r.lawyer.locations[0];
  const firm = r.lawyer.firm;
  return resolveCoordsFromParts({
    postcode: loc?.postcode,
    city: loc?.city,
    existingLat: loc?.latitude,
    existingLng: loc?.longitude,
    normalizedAddress: undefined,
    address: undefined,
  }).then(async (fromLoc) => {
    if (fromLoc) return fromLoc;
    if (!firm) return null;
    return resolveCoordsFromParts({
      postcode: firm.postcode ?? undefined,
      city: firm.city ?? undefined,
      existingLat: firm.latitude,
      existingLng: firm.longitude,
      normalizedAddress: firm.normalizedAddress,
    });
  });
}

async function resolveOrgCoords(
  r: Extract<RankedCandidate, { kind: "org" }>,
): Promise<ResolvedCoords | null> {
  let lat = null as number | null;
  let lng = null as number | null;
  let normalizedAddress: string | null = null;

  try {
    const row = await prisma.sraOrganisation.findUnique({
      where: { id: r.org.id },
      select: {
        latitude: true,
        longitude: true,
        normalizedAddress: true,
        city: true,
        postcode: true,
      },
    });
    if (row) {
      lat = row.latitude;
      lng = row.longitude;
      normalizedAddress = row.normalizedAddress;
    }
  } catch {
    // continue with lite org fields
  }

  return resolveCoordsFromParts({
    postcode: r.org.postcode,
    city: r.org.city,
    existingLat: lat,
    existingLng: lng,
    normalizedAddress,
  });
}

export function buildMapMarkerForMatch(args: {
  matchId: string;
  entityType: "lawyer" | "sra_organisation";
  title: string;
  practiceAreaNames: string[];
  coords: ResolvedCoords;
  url?: string;
  verified?: boolean;
  explanation?: string;
  origin?: LatLng;
}): { location: MatchLocation; mapMarker: MapMarker } {
  const label = locationLabel(args.coords.city, args.coords.postcode);
  const distanceMilesVal = args.origin
    ? distanceMiles(args.origin, { lat: args.coords.lat, lng: args.coords.lng })
    : undefined;

  const location: MatchLocation = {
    latitude: args.coords.lat,
    longitude: args.coords.lng,
    address: args.coords.address,
    city: args.coords.city,
    postcode: args.coords.postcode,
    locationLabel: label,
    distanceMiles:
      distanceMilesVal != null && Number.isFinite(distanceMilesVal)
        ? Math.round(distanceMilesVal * 10) / 10
        : undefined,
  };

  const mapMarker: MapMarker = {
    id: `m:${args.matchId}`,
    entityId: args.matchId,
    entityType: args.entityType,
    title: args.title,
    subtitle: args.practiceAreaNames[0],
    practiceAreas: args.practiceAreaNames,
    address: args.coords.address,
    city: args.coords.city,
    postcode: args.coords.postcode,
    lat: args.coords.lat,
    lng: args.coords.lng,
    source: args.entityType === "lawyer" ? "lawyer" : "sra",
    verified: args.verified,
    url: args.url,
    explanation: args.explanation,
  };

  if (location.distanceMiles != null) {
    mapMarker.subtitle = mapMarker.subtitle
      ? `${mapMarker.subtitle} · ${location.distanceMiles} mi`
      : `${location.distanceMiles} mi away`;
  }

  return { location, mapMarker };
}

export async function resolveRankedCandidateLocation(
  r: RankedCandidate,
  origin?: LatLng,
): Promise<{ location?: MatchLocation; mapMarker?: MapMarker }> {
  const coords =
    r.kind === "lawyer" ? await resolveLawyerCoords(r) : await resolveOrgCoords(r);
  if (!coords) return {};

  const matchId = r.kind === "lawyer" ? r.lawyer.id : r.org.id;
  const title = r.kind === "lawyer" ? r.lawyer.name : r.org.businessName;
  const practiceAreaNames =
    r.kind === "lawyer"
      ? r.lawyer.practiceAreas.map((p) => p.practiceArea.name)
      : [];
  const url =
    r.kind === "lawyer"
      ? r.lawyer.profileUrl ?? undefined
      : r.org.sraProfileUrl;
  const verified = r.kind === "lawyer" ? r.lawyer.verifiedCredentials : true;

  return buildMapMarkerForMatch({
    matchId,
    entityType: r.kind === "lawyer" ? "lawyer" : "sra_organisation",
    title,
    practiceAreaNames,
    coords,
    url,
    verified,
    origin,
  });
}
