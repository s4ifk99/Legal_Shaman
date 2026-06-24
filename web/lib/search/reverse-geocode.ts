import "server-only";

import { isValidUkCoordinate } from "@/lib/search/location";

const NOMINATIM_UA =
  process.env.GEOCODING_USER_AGENT?.trim() || "LegalShaman/1.0 (location search)";

export type ReverseGeocodeResult = {
  city?: string;
  postcode?: string;
  label: string;
  lat: number;
  lng: number;
};

function pickCityFromNominatimAddress(addr: Record<string, string | undefined>): string | undefined {
  return (
    addr.city ??
    addr.town ??
    addr.village ??
    addr.suburb ??
    addr.borough ??
    addr.county ??
    addr.state_district
  );
}

export async function reverseGeocodeUk(
  lat: number,
  lng: number,
): Promise<ReverseGeocodeResult | null> {
  if (!isValidUkCoordinate(lat, lng)) return null;

  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("format", "json");
    url.searchParams.set("zoom", "12");
    url.searchParams.set("addressdetails", "1");

    const res = await fetch(url.toString(), {
      headers: { "User-Agent": NOMINATIM_UA },
      signal: AbortSignal.timeout(12000),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      display_name?: string;
      address?: Record<string, string | undefined>;
    };
    const address = data.address ?? {};
    const city = pickCityFromNominatimAddress(address);
    const postcode = address.postcode;
    const label = [city, postcode].filter(Boolean).join(", ") || data.display_name || "Your area";

    return { city, postcode, label, lat, lng };
  } catch {
    return null;
  }
}
