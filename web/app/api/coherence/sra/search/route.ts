import { NextResponse } from "next/server";

import { coherenceDatabaseUrl } from "@/lib/coherence/config";
import { coherenceApiGuard } from "@/lib/coherence/server/guard";
import {
  proxyCoherenceBackendPath,
  shouldProxySraToHomeBackend,
} from "@/lib/coherence/server/gateway";
import { sraQuery } from "@/lib/coherence/server/sra-db";
import { searchSraOrganisationsTypesense } from "@/lib/coherence/server/sra-typesense-search";
import {
  hasPracticeRoute,
  postcodePrefixesForLocation,
  resolveSraSearchFlags,
} from "@/lib/coherence/sraQuery";
import { sraOrganisationAdmissible } from "@/lib/matter/graphAdmissibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;

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
    wantDefamation?: boolean;
    wantFamily?: boolean;
    wantDebt?: boolean;
    wantPersonalInjury?: boolean;
    wantLitigation?: boolean;
    wantCrime?: boolean;
    taxonomySlug?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ hits: [], error: "invalid_json" }, { status: 400 });
  }

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
    wantDefamation: body.wantDefamation,
    wantFamily: body.wantFamily,
    wantDebt: body.wantDebt,
    wantPersonalInjury: body.wantPersonalInjury,
    wantLitigation: body.wantLitigation,
    wantCrime: body.wantCrime,
  });
  const {
    wantImmigration,
    wantConsumer,
    wantCar,
    wantHousing,
    wantEmployment,
    wantMotoring,
    wantDefamation,
    wantFamily,
    wantDebt,
    wantPersonalInjury,
    wantLitigation,
    wantCrime,
  } = flags;

  if (!hasPracticeRoute(flags) && !hint) {
    return NextResponse.json({
      hits: [],
      error: "no_practice_route",
      emptyReason: "no_practice_route",
    });
  }

  const london = /\blondon\b/i.test(hint);
  const countyPrefixes = postcodePrefixesForLocation(hint);
  const cityNeedle =
    countyPrefixes.length > 1 || (countyPrefixes.length === 1 && !/^[A-Z]{1,2}\d/i.test(hint.trim()))
      ? ""
      : hint.replace(/[^a-zA-Z\s]/g, " ").trim();
  const postcodeArea =
    countyPrefixes.length > 0
      ? countyPrefixes.join("|")
      : hint.toUpperCase().match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\b/)?.[1] || null;
  const parkingConsumer = wantConsumer && !wantMotoring;
  const minScore = wantDefamation || wantFamily || wantDebt || wantPersonalInjury || wantLitigation
    ? 14
    : wantCrime && !wantMotoring
      ? 16
      : wantMotoring
        ? 16
        : parkingConsumer
          ? 16
          : wantConsumer || wantCar
            ? 18
            : wantImmigration
              ? 16
              : wantHousing && !hint
                ? 20
                : 12;

  async function typesenseHits() {
    return searchSraOrganisationsTypesense({ flags, limit, minScore });
  }

  if (!coherenceDatabaseUrl()) {
    const hits = await typesenseHits();
    if (hits.length) return NextResponse.json({ hits, source: "typesense" });
    if (shouldProxySraToHomeBackend()) {
      return proxyCoherenceBackendPath({
        path: "/api/coherence/sra/search",
        method: "POST",
        body,
        timeoutMs: 15_000,
      });
    }
    return NextResponse.json({
      hits: [],
      error: "sra_directory_unavailable",
      emptyReason: "unavailable",
    });
  }

  try {
    // $1 immigration $2 london $3 city $4 postcode $5 limit
    // $6 consumer $7 housing $8 employment $9 car $10 minScore $11 motoring
    // $12 defamation $13 family $14 debt $15 PI $16 litigation $17 crime
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
            + CASE WHEN $6::boolean AND work_area::text ILIKE '%"Litigation%' THEN 8 ELSE 0 END
            + CASE WHEN $6::boolean AND NOT $11::boolean AND $4::text IS NOT NULL AND $4::text <> ''
                AND upper(postcode) ~ ('^(' || $4 || ')[0-9A-Z]?')
                AND work_area::text ILIKE '%"Litigation%' THEN 22 ELSE 0 END
            + CASE WHEN $9::boolean AND (
              search_text ILIKE '%motor%' OR search_text ILIKE '%vehicle%'
              OR search_text ILIKE '%trader%' OR search_text ILIKE '%sale of goods%'
              OR business_name ILIKE '%motor%'
            ) THEN 10 ELSE 0 END
            + CASE WHEN $7::boolean AND (
              work_area::text ILIKE '%Housing%'
              OR work_area::text ILIKE '%Landlord%'
              OR work_area::text ILIKE '%Tenant%'
            ) THEN 28 ELSE 0 END
            + CASE WHEN $7::boolean AND work_area::text ILIKE '%Property - Residential%'
                AND work_area::text NOT ILIKE '%Intellectual Property%' THEN 10 ELSE 0 END
            + CASE WHEN $8::boolean AND work_area::text ILIKE '%Employment%' THEN 24 ELSE 0 END
            + CASE WHEN $11::boolean AND (
              work_area::text ILIKE '%Motoring%'
              OR work_area::text ILIKE '%"Criminal"%'
              OR work_area::text ILIKE '%Crime -%'
              OR search_text ILIKE '%road traffic%'
              OR search_text ILIKE '%parking ticket%'
              OR search_text ILIKE '%pcn%'
            ) THEN 32 ELSE 0 END
            + CASE WHEN $11::boolean AND work_area::text ILIKE '%Consumer%' THEN 12 ELSE 0 END
            + CASE WHEN $12::boolean AND (
              work_area::text ILIKE '%Defamation%'
              OR work_area::text ILIKE '%Libel%'
              OR work_area::text ILIKE '%Slander%'
            ) THEN 36 ELSE 0 END
            + CASE WHEN $12::boolean AND (
              work_area::text ILIKE '%Media and Entertainment%'
              OR work_area::text ILIKE '%"Media"%'
            ) THEN 24 ELSE 0 END
            + CASE WHEN $12::boolean AND work_area::text ILIKE '%"Litigation%' THEN 12 ELSE 0 END
            + CASE WHEN $13::boolean AND (
              work_area::text ILIKE '%Family%'
              OR work_area::text ILIKE '%Children%'
              OR work_area::text ILIKE '%Matrimonial%'
              OR work_area::text ILIKE '%Divorce%'
            ) THEN 28 ELSE 0 END
            + CASE WHEN $14::boolean AND (
              work_area::text ILIKE '%Debt%'
              OR work_area::text ILIKE '%Insolvency%'
              OR work_area::text ILIKE '%Bankruptcy%'
            ) THEN 28 ELSE 0 END
            + CASE WHEN $15::boolean AND (
              work_area::text ILIKE '%Personal Injury%'
              OR work_area::text ILIKE '%Clinical Negligence%'
              OR work_area::text ILIKE '%Medical Negligence%'
            ) THEN 28 ELSE 0 END
            + CASE WHEN $16::boolean AND work_area::text ILIKE '%"Litigation%' THEN 22 ELSE 0 END
            + CASE WHEN $17::boolean AND NOT $11::boolean AND (
              work_area::text ILIKE '%"Criminal"%'
              OR work_area::text ILIKE '%Crime -%'
            ) THEN 32 ELSE 0 END
            + CASE WHEN $2::boolean AND postcode ~* '^(E|EC|N|NW|SE|SW|W|WC)[0-9]' THEN 12 ELSE 0 END
            + CASE WHEN $2::boolean AND postcode ~* '^(BR|CR|DA|EN|HA|IG|KT|RM|SM|TW|UB|WD)[0-9]' THEN 8 ELSE 0 END
            + CASE WHEN $3::text <> '' AND city ILIKE '%' || $3 || '%' THEN 12 ELSE 0 END
            + CASE WHEN $4::text IS NOT NULL AND $4::text <> '' AND upper(postcode) ~ ('^(' || $4 || ')[0-9A-Z]?') THEN 18 ELSE 0 END
            + CASE WHEN COALESCE(phone, '') <> '' THEN 8 ELSE 0 END
            + CASE WHEN authorisation_status IS NULL OR authorisation_status ILIKE '%authoris%' THEN 1 ELSE 0 END
            - CASE WHEN NOT $1::boolean AND work_area::text ILIKE '%Immigration%' THEN 14 ELSE 0 END
            - CASE WHEN $6::boolean AND NOT $11::boolean AND work_area::text NOT ILIKE '%Consumer%'
                AND NOT (
                  $4::text IS NOT NULL AND $4::text <> ''
                  AND upper(postcode) ~ ('^(' || $4 || ')[0-9A-Z]?')
                  AND work_area::text ILIKE '%"Litigation%'
                ) THEN 20 ELSE 0 END
            - CASE WHEN $6::boolean AND NOT $11::boolean AND work_area::text ILIKE '%Criminal%'
                AND work_area::text NOT ILIKE '%Consumer%'
                AND work_area::text NOT ILIKE '%"Litigation%' THEN 40 ELSE 0 END
            - CASE WHEN $11::boolean AND work_area::text ILIKE '%Employment%' THEN 30 ELSE 0 END
            - CASE WHEN $9::boolean AND work_area::text ILIKE '%Personal Injury%' AND work_area::text NOT ILIKE '%"Litigation%' THEN 14 ELSE 0 END
            - CASE WHEN $7::boolean AND work_area::text ILIKE '%Intellectual Property%' THEN 40 ELSE 0 END
            - CASE WHEN $7::boolean AND work_area::text ILIKE '%Property - Commercial%'
                AND work_area::text NOT ILIKE '%Housing%'
                AND work_area::text NOT ILIKE '%Landlord%'
                AND work_area::text NOT ILIKE '%Tenant%' THEN 22 ELSE 0 END
          )::int AS score
        FROM sra_organisations
        WHERE
          ($1::boolean AND work_area::text ILIKE '%Immigration%')
          OR ($6::boolean AND work_area::text ILIKE '%Consumer%')
          OR ($6::boolean AND NOT $11::boolean AND work_area::text ILIKE '%"Litigation%'
            AND $4::text IS NOT NULL AND $4::text <> ''
            AND upper(postcode) ~ ('^(' || $4 || ')[0-9A-Z]?'))
          OR ($7::boolean AND (
            work_area::text ILIKE '%Housing%'
            OR work_area::text ILIKE '%Landlord%'
            OR work_area::text ILIKE '%Tenant%'
            OR (
              work_area::text ILIKE '%Property - Residential%'
              AND work_area::text NOT ILIKE '%Intellectual Property%'
            )
          ))
          OR ($8::boolean AND work_area::text ILIKE '%Employment%')
          OR ($11::boolean AND (
            work_area::text ILIKE '%Motoring%'
            OR work_area::text ILIKE '%"Criminal"%'
            OR work_area::text ILIKE '%Crime -%'
            OR work_area::text ILIKE '%Consumer%'
            OR search_text ILIKE '%road traffic%'
            OR search_text ILIKE '%parking ticket%'
          ))
          OR ($12::boolean AND (
            work_area::text ILIKE '%Defamation%'
            OR work_area::text ILIKE '%Libel%'
            OR work_area::text ILIKE '%Slander%'
            OR work_area::text ILIKE '%Media and Entertainment%'
            OR work_area::text ILIKE '%"Litigation%'
          ))
          OR ($13::boolean AND (
            work_area::text ILIKE '%Family%'
            OR work_area::text ILIKE '%Children%'
            OR work_area::text ILIKE '%Matrimonial%'
            OR work_area::text ILIKE '%Divorce%'
          ))
          OR ($14::boolean AND (
            work_area::text ILIKE '%Debt%'
            OR work_area::text ILIKE '%Insolvency%'
            OR work_area::text ILIKE '%Bankruptcy%'
          ))
          OR ($15::boolean AND (
            work_area::text ILIKE '%Personal Injury%'
            OR work_area::text ILIKE '%Clinical Negligence%'
            OR work_area::text ILIKE '%Medical Negligence%'
          ))
          OR ($16::boolean AND work_area::text ILIKE '%"Litigation%')
          OR ($17::boolean AND (
            work_area::text ILIKE '%"Criminal"%'
            OR work_area::text ILIKE '%Crime -%'
          ))
          OR ($3::text <> '' AND city ILIKE '%' || $3 || '%')
          OR ($4::text IS NOT NULL AND $4::text <> '' AND upper(postcode) ~ ('^(' || $4 || ')[0-9A-Z]?'))
      ) ranked
      WHERE score >= $10::int
      ORDER BY score DESC,
        CASE WHEN COALESCE(phone, '') <> '' THEN 0 ELSE 1 END,
        work_area_count ASC,
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
      wantDefamation,
      wantFamily,
      wantDebt,
      wantPersonalInjury,
      wantLitigation,
      wantCrime,
    ]);

    const hits = result.rows
      .map((r) => ({
        sraId: r.sra_id,
        name: r.name,
        city: r.city,
        postcode: r.postcode,
        phone: r.phone,
        website: r.website,
        profileUrl: r.profile_url,
        workArea: r.work_area,
        score: Number(r.score) || 0,
      }))
      .filter((hit) => sraOrganisationAdmissible(String(hit.name || "")));

    return NextResponse.json({
      hits,
      emptyReason: hits.length ? undefined : "no_matches",
    });
  } catch (err) {
    const hits = await typesenseHits();
    if (hits.length) return NextResponse.json({ hits, source: "typesense" });
    if (shouldProxySraToHomeBackend()) {
      return proxyCoherenceBackendPath({
        path: "/api/coherence/sra/search",
        method: "POST",
        body,
        timeoutMs: 15_000,
      });
    }
    return NextResponse.json(
      {
        hits: [],
        error: err instanceof Error ? err.message : "search failed",
        emptyReason: "unavailable",
      },
      { status: 500 },
    );
  }
}
