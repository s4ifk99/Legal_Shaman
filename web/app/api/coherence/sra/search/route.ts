import { NextResponse } from "next/server";

import { coherenceDatabaseUrl } from "@/lib/coherence/config";
import { coherenceApiGuard } from "@/lib/coherence/server/guard";
import { sraQuery } from "@/lib/coherence/server/sra-db";
import { resolveSraSearchFlags } from "@/lib/coherence/sraQuery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;

  if (!coherenceDatabaseUrl()) {
    return NextResponse.json({ hits: [], error: "DATABASE_URL not set" }, { status: 503 });
  }

  let body: {
    locationHint?: string;
    matterType?: string;
    query?: string;
    limit?: number;
    wantCar?: boolean;
    wantConsumer?: boolean;
    wantHousing?: boolean;
    wantEmployment?: boolean;
    wantImmigration?: boolean;
    wantMotoring?: boolean;
    taxonomySlug?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ hits: [], error: "invalid_json" }, { status: 400 });
  }

  try {
    const limit = Math.min(Math.max(Number(body.limit) || 5, 1), 12);
    const hint = (body.locationHint || "").trim();
    const flags = resolveSraSearchFlags({
      matterType: body.matterType,
      query: body.query,
      taxonomySlug: body.taxonomySlug,
      wantCar: body.wantCar,
      wantConsumer: body.wantConsumer,
      wantHousing: body.wantHousing,
      wantEmployment: body.wantEmployment,
      wantImmigration: body.wantImmigration,
      wantMotoring: body.wantMotoring,
    });
    const {
      wantImmigration,
      wantConsumer,
      wantCar,
      wantHousing,
      wantEmployment,
      wantMotoring,
    } = flags;

    const london = /\blondon\b/i.test(hint);
    const cityNeedle = hint.replace(/[^a-zA-Z\s]/g, " ").trim();
    const postcodeArea = hint.toUpperCase().match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\b/)?.[1] || null;
    const minScore = wantMotoring ? 16 : wantConsumer || wantCar ? 18 : wantImmigration ? 16 : 12;

    const sql = `
      SELECT * FROM (
        SELECT
          sra_id,
          COALESCE(NULLIF(display_name, ''), NULLIF(business_name, ''), NULLIF(organisation_name, ''), 'SRA organisation') AS name,
          COALESCE(city, '') AS city,
          COALESCE(postcode, '') AS postcode,
          COALESCE(phone, '') AS phone,
          COALESCE(website, '') AS website,
          COALESCE(sra_profile_url, '') AS profile_url,
          COALESCE(work_area::text, '') AS work_area,
          CASE
            WHEN jsonb_typeof(work_area) = 'array' THEN jsonb_array_length(work_area)
            ELSE 0
          END AS work_area_count,
          (
            CASE WHEN $1::boolean AND work_area::text ILIKE '%Immigration%' THEN 24 ELSE 0 END
            + CASE WHEN $6::boolean AND NOT $11::boolean AND work_area::text ILIKE '%Consumer%' THEN 28 ELSE 0 END
            + CASE WHEN $9::boolean AND work_area::text ILIKE '%Consumer%' THEN 8 ELSE 0 END
            + CASE WHEN $6::boolean AND work_area::text ILIKE '%Litigation%' THEN 8 ELSE 0 END
            + CASE WHEN $9::boolean AND (
              search_text ILIKE '%motor%' OR search_text ILIKE '%vehicle%'
              OR search_text ILIKE '%trader%' OR search_text ILIKE '%sale of goods%'
              OR business_name ILIKE '%motor%'
            ) THEN 10 ELSE 0 END
            + CASE WHEN $7::boolean AND (
              work_area::text ILIKE '%Housing%' OR work_area::text ILIKE '%Landlord%'
              OR work_area::text ILIKE '%Tenant%'
              OR work_area::text ILIKE '%Property - Residential%'
              OR work_area::text ILIKE '%Property%'
            ) THEN 24 ELSE 0 END
            + CASE WHEN $8::boolean AND work_area::text ILIKE '%Employment%' THEN 24 ELSE 0 END
            + CASE WHEN $11::boolean AND (
              work_area::text ILIKE '%Motoring%'
              OR work_area::text ILIKE '%Crime%'
              OR search_text ILIKE '%road traffic%'
              OR search_text ILIKE '%parking ticket%'
              OR search_text ILIKE '%pcn%'
            ) THEN 32 ELSE 0 END
            + CASE WHEN $11::boolean AND work_area::text ILIKE '%Consumer%' THEN 12 ELSE 0 END
            + CASE WHEN $2::boolean AND postcode ~* '^(E|EC|N|NW|SE|SW|W|WC)[0-9]' THEN 12 ELSE 0 END
            + CASE WHEN $2::boolean AND postcode ~* '^(BR|CR|DA|EN|HA|IG|KT|RM|SM|TW|UB|WD)[0-9]' THEN 8 ELSE 0 END
            + CASE WHEN $3::text <> '' AND city ILIKE '%' || $3 || '%' THEN 12 ELSE 0 END
            + CASE WHEN $4::text IS NOT NULL AND upper(postcode) LIKE $4 || '%' THEN 14 ELSE 0 END
            + CASE WHEN COALESCE(phone, '') <> '' THEN 2 ELSE 0 END
            + CASE WHEN authorisation_status IS NULL OR authorisation_status ILIKE '%authoris%' THEN 1 ELSE 0 END
            - CASE WHEN NOT $1::boolean AND work_area::text ILIKE '%Immigration%' THEN 14 ELSE 0 END
            - CASE WHEN $6::boolean AND NOT $11::boolean AND work_area::text NOT ILIKE '%Consumer%' THEN 20 ELSE 0 END
            - CASE WHEN $11::boolean AND work_area::text ILIKE '%Employment%' THEN 30 ELSE 0 END
            - CASE WHEN $9::boolean AND work_area::text ILIKE '%Personal Injury%' AND work_area::text NOT ILIKE '%Litigation%' THEN 14 ELSE 0 END
          )::int AS score
        FROM sra_organisations
        WHERE
          ($1::boolean AND work_area::text ILIKE '%Immigration%')
          OR ($6::boolean AND work_area::text ILIKE '%Consumer%')
          OR ($7::boolean AND (
            work_area::text ILIKE '%Housing%'
            OR work_area::text ILIKE '%Landlord%'
            OR work_area::text ILIKE '%Tenant%'
            OR work_area::text ILIKE '%Property - Residential%'
            OR work_area::text ILIKE '%Property%'
          ))
          OR ($8::boolean AND work_area::text ILIKE '%Employment%')
          OR ($11::boolean AND (
            work_area::text ILIKE '%Motoring%'
            OR work_area::text ILIKE '%Crime%'
            OR work_area::text ILIKE '%Consumer%'
            OR search_text ILIKE '%road traffic%'
            OR search_text ILIKE '%parking ticket%'
          ))
          OR ($3::text <> '' AND city ILIKE '%' || $3 || '%')
          OR ($4::text IS NOT NULL AND upper(postcode) LIKE $4 || '%')
      ) ranked
      WHERE score >= $10::int
      ORDER BY score DESC,
        work_area_count ASC,
        CASE WHEN COALESCE(phone, '') <> '' THEN 0 ELSE 1 END,
        name ASC
      LIMIT $5
    `;

    const result = await sraQuery<{ rows: Record<string, unknown>[] }>(sql, [
      wantImmigration,
      london,
      london ? "" : cityNeedle.slice(0, 40),
      postcodeArea,
      limit,
      wantConsumer,
      wantHousing,
      wantEmployment,
      wantCar,
      minScore,
      wantMotoring,
    ]);

    return NextResponse.json({
      hits: result.rows.map((r) => ({
        sraId: r.sra_id,
        name: r.name,
        city: r.city,
        postcode: r.postcode,
        phone: r.phone,
        website: r.website,
        profileUrl: r.profile_url,
        workArea: r.work_area,
        score: Number(r.score) || 0,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      {
        hits: [],
        error: err instanceof Error ? err.message : "search failed",
      },
      { status: 500 },
    );
  }
}
