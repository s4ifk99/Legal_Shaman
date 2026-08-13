import { NextResponse } from "next/server";

import { coherenceDatabaseUrl } from "@/lib/coherence/config";
import { coherenceApiGuard } from "@/lib/coherence/server/guard";
import { sraQuery } from "@/lib/coherence/server/sra-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ sraId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;

  const { sraId: rawId } = await ctx.params;
  const sraId = decodeURIComponent(rawId || "").trim();
  if (!sraId) {
    return NextResponse.json({ error: "SRA id required" }, { status: 400 });
  }
  if (!coherenceDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 503 });
  }

  try {
    const result = await sraQuery<{ rows: Record<string, unknown>[] }>(
      `
      SELECT
        sra_id,
        COALESCE(NULLIF(display_name, ''), NULLIF(business_name, ''), NULLIF(organisation_name, ''), 'SRA organisation') AS name,
        COALESCE(business_name, '') AS business_name,
        COALESCE(organisation_name, '') AS organisation_name,
        COALESCE(city, '') AS city,
        COALESCE(postcode, '') AS postcode,
        COALESCE(county, '') AS county,
        COALESCE(country, '') AS country,
        COALESCE(phone, '') AS phone,
        COALESCE(email, '') AS email,
        COALESCE(website, '') AS website,
        COALESCE(sra_profile_url, '') AS profile_url,
        COALESCE(work_area::text, '[]') AS work_area,
        COALESCE(authorisation_status, '') AS authorisation_status
      FROM sra_organisations
      WHERE sra_id = $1
      LIMIT 1
    `,
      [sraId],
    );
    const row = result.rows[0];
    if (!row) {
      return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
    }
    return NextResponse.json({
      organisation: {
        sraId: row.sra_id,
        name: row.name,
        businessName: row.business_name,
        organisationName: row.organisation_name,
        city: row.city,
        postcode: row.postcode,
        county: row.county,
        country: row.country,
        phone: row.phone,
        email: row.email,
        website: row.website,
        profileUrl: row.profile_url,
        workArea: row.work_area,
        authorisationStatus: row.authorisation_status,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "lookup failed" },
      { status: 500 },
    );
  }
}
