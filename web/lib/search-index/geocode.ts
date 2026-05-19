import { prisma } from "@/lib/db/prisma";
import { geocodeUkLocation } from "@/lib/search/geocoding-provider";
import { geocodeCacheKey, normalisePostcode } from "@/lib/search-index/normalise-address";

export type GeoPoint = { latitude: number; longitude: number; confidence: number };

function enableGeocoding(): boolean {
  const v = process.env.ENABLE_GEOCODING?.trim().toLowerCase();
  if (v === undefined || v === "") return true;
  return v === "1" || v === "true" || v === "yes";
}

/** Resolve coordinates for indexing; uses Postgres cache when DATABASE_URL is set. */
export async function resolveGeoForIndex(parts: {
  postcode?: string;
  city?: string;
  address?: string;
  existingLat?: number | null;
  existingLng?: number | null;
}): Promise<GeoPoint | null> {
  if (
    parts.existingLat != null &&
    parts.existingLng != null &&
    Number.isFinite(parts.existingLat) &&
    Number.isFinite(parts.existingLng)
  ) {
    return { latitude: parts.existingLat, longitude: parts.existingLng, confidence: 0.99 };
  }

  const cached = await lookupGeocodedCache(parts);
  if (cached) return cached;

  if (!enableGeocoding()) return null;

  const result = await geocodeUkLocation({
    postcode: parts.postcode,
    city: parts.city,
    address: parts.address,
  });
  if (!result) return null;

  const key = geocodeCacheKey(parts);
  if (!key) {
    return {
      latitude: result.latitude,
      longitude: result.longitude,
      confidence: result.confidence,
    };
  }

  try {
    await prisma.geocodedLocation.upsert({
      where: { normalizedInput: key },
      create: {
        input: key,
        normalizedInput: key,
        address: result.address,
        postcode: result.postcode ? normalisePostcode(result.postcode) : parts.postcode,
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

  return {
    latitude: result.latitude,
    longitude: result.longitude,
    confidence: result.confidence,
  };
}

export type GeocodedCacheHit = GeoPoint & {
  address?: string;
  city?: string;
  postcode?: string;
};

/** Read-only cache lookup — no external HTTP. Safe for matcher request path. */
export async function lookupGeocodedCache(parts: {
  postcode?: string;
  city?: string;
  address?: string;
}): Promise<GeocodedCacheHit | null> {
  const key = geocodeCacheKey(parts);
  if (!key) return null;

  try {
    const cached = await prisma.geocodedLocation.findUnique({
      where: { normalizedInput: key },
    });
    if (cached?.latitude == null || cached.longitude == null) return null;
    return {
      latitude: cached.latitude,
      longitude: cached.longitude,
      confidence: cached.confidence ?? 0.9,
      address: cached.address ?? undefined,
      city: cached.city ?? undefined,
      postcode: cached.postcode ?? undefined,
    };
  } catch {
    return null;
  }
}
