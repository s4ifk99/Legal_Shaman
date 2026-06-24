import { NextResponse } from "next/server";
import { z } from "zod";
import { reverseGeocodeUk } from "@/lib/search/reverse-geocode";

export const runtime = "nodejs";

const QuerySchema = z.object({
  lat: z.coerce.number().finite(),
  lng: z.coerce.number().finite(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    lat: url.searchParams.get("lat"),
    lng: url.searchParams.get("lng"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  const result = await reverseGeocodeUk(parsed.data.lat, parsed.data.lng);
  if (!result) {
    return NextResponse.json({ error: "Could not resolve location" }, { status: 404 });
  }

  return NextResponse.json(result);
}
