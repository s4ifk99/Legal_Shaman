/**
 * Geo helpers for map search (shared by directory + map API).
 */

export type LatLng = { lat: number; lng: number };

export type MapBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export function distanceMiles(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function parseMapBounds(sp: {
  north?: string;
  south?: string;
  east?: string;
  west?: string;
}): MapBounds | null {
  const north = Number(sp.north);
  const south = Number(sp.south);
  const east = Number(sp.east);
  const west = Number(sp.west);
  if (![north, south, east, west].every(Number.isFinite)) return null;
  return { north, south, east, west };
}

export function boundsCenter(b: MapBounds): LatLng {
  return { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 };
}

export function radiusKmFromBounds(b: MapBounds): number {
  const c = boundsCenter(b);
  const corner = { lat: b.north, lng: b.east };
  return Math.max(1, distanceMiles(c, corner) * 1.60934);
}

export function pointInBounds(p: LatLng, b: MapBounds): boolean {
  return p.lat <= b.north && p.lat >= b.south && p.lng <= b.east && p.lng >= b.west;
}

const UK_LAT_MIN = 49;
const UK_LAT_MAX = 61;
const UK_LNG_MIN = -8;
const UK_LNG_MAX = 2;

export function isValidUkCoordinate(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return lat >= UK_LAT_MIN && lat <= UK_LAT_MAX && lng >= UK_LNG_MIN && lng <= UK_LNG_MAX;
}
