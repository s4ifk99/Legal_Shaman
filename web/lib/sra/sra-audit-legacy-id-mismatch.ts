import { Prisma, type PrismaClient } from "@prisma/client";

import { sraNumberFromRaw } from "@/lib/search/sra-document";

export type SraLegacyIdMismatchExample = {
  localSraId: string;
  displayName: string;
  mismatchType: string;
  apiId: string | null;
  apiSraNumber: string | null;
  dbSraNumberRowExists: boolean;
  dbIdRowExists: boolean;
  apiPracticeName: string | null;
};

export type SraLegacyIdMismatchReport = {
  sampleSize: number;
  apiOrganisationCount: number;
  localMatchesApiId: number;
  localMatchesApiSraNumber: number;
  localIdWithSraNumberRowInDb: number;
  localSraNumberWithIdRowInDb: number;
  unmatchedInApi: number;
  mismatches: SraLegacyIdMismatchExample[];
};

type PlaceholderSampleRow = {
  sra_id: string;
  display_name: string;
};

const DEFAULT_SAMPLE = 50;

function asString(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

async function fetchGetAllOrganisations(key: string): Promise<Record<string, unknown>[]> {
  const startUrl =
    process.env.SRA_ORGANISATIONS_URL?.trim() ||
    "https://sra-prod-apim.azure-api.net/datashare/api/V1/organisation/GetAll";
  const res = await fetch(startUrl, { headers: { "Ocp-Apim-Subscription-Key": key } });
  if (!res.ok) {
    throw new Error(`SRA HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const body: unknown = await res.json();
  if (Array.isArray(body)) {
    return body.filter((r) => r && typeof r === "object") as Record<string, unknown>[];
  }
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    for (const k of ["value", "items", "data", "organisations", "Organisations"]) {
      if (Array.isArray(o[k])) {
        return (o[k] as unknown[]).filter((r) => r && typeof r === "object") as Record<
          string,
          unknown
        >[];
      }
    }
  }
  return [];
}

export async function auditSraLegacyIdMismatch(
  prisma: PrismaClient,
  sraKey: string,
  options?: { sampleSize?: number },
): Promise<SraLegacyIdMismatchReport> {
  const sampleSize = options?.sampleSize ?? DEFAULT_SAMPLE;

  const sample = await prisma.$queryRaw<PlaceholderSampleRow[]>`
    SELECT sra_id, display_name
    FROM sra_organisations
    WHERE display_name LIKE 'SRA organisation%'
    ORDER BY sra_id
    LIMIT ${sampleSize}
  `;

  const apiRows = await fetchGetAllOrganisations(sraKey);
  const byApiId = new Map<string, Record<string, unknown>>();
  const bySraNumber = new Map<string, Record<string, unknown>>();
  for (const row of apiRows) {
    const id = asString(row.Id ?? row.id);
    const sraNumber = asString(row.SraNumber ?? row.sraNumber) || sraNumberFromRaw(row);
    if (id) byApiId.set(id, row);
    if (sraNumber) bySraNumber.set(sraNumber, row);
  }

  const idsToCheck = new Set<string>(sample.map((r) => r.sra_id));
  for (const row of sample) {
    const apiById = byApiId.get(row.sra_id);
    if (apiById) {
      const sn =
        asString(apiById.SraNumber ?? apiById.sraNumber) || sraNumberFromRaw(apiById);
      if (sn) idsToCheck.add(sn);
    }
    const apiBySn = bySraNumber.get(row.sra_id);
    if (apiBySn) {
      const id = asString(apiBySn.Id ?? apiBySn.id);
      if (id) idsToCheck.add(id);
    }
  }

  const dbIdSet = new Set<string>();
  const idList = [...idsToCheck];
  if (idList.length) {
    const existing = await prisma.$queryRaw<{ sra_id: string }[]>`
      SELECT sra_id FROM sra_organisations WHERE sra_id IN (${Prisma.join(idList)})
    `;
    for (const r of existing) dbIdSet.add(r.sra_id);
  }

  let localMatchesApiId = 0;
  let localMatchesApiSraNumber = 0;
  let localIdWithSraNumberRowInDb = 0;
  let localSraNumberWithIdRowInDb = 0;
  let unmatchedInApi = 0;
  const mismatches: SraLegacyIdMismatchExample[] = [];

  for (const row of sample) {
    const localSraId = row.sra_id;
    const apiById = byApiId.get(localSraId);
    const apiBySraNumber = bySraNumber.get(localSraId);

    const apiId = apiById ? localSraId : apiBySraNumber ? asString(apiBySraNumber.Id ?? apiBySraNumber.id) : null;
    const apiSraNumber = apiBySraNumber
      ? localSraId
      : apiById
        ? asString(apiById.SraNumber ?? apiById.sraNumber) || sraNumberFromRaw(apiById)
        : null;

    const apiOrg = apiById ?? apiBySraNumber ?? null;
    const practiceName = apiOrg
      ? asString(apiOrg.PracticeName ?? apiOrg.practiceName ?? apiOrg.AuthorisedName)
      : null;

    const dbSraNumberRowExists = apiSraNumber ? dbIdSet.has(apiSraNumber) : false;
    const dbIdRowExists = apiId ? dbIdSet.has(apiId) : dbIdSet.has(localSraId);

    let mismatchType = "unmatched_in_api";
    if (apiById && !apiBySraNumber) {
      mismatchType = "local_matches_api_Id_not_SraNumber";
      localMatchesApiId++;
      if (apiSraNumber && dbSraNumberRowExists) localIdWithSraNumberRowInDb++;
    } else if (apiBySraNumber && !apiById) {
      mismatchType = "local_matches_api_SraNumber";
      localMatchesApiSraNumber++;
    } else if (apiById && apiBySraNumber) {
      mismatchType = "local_matches_both_id_and_sra_number";
      localMatchesApiId++;
      localMatchesApiSraNumber++;
    } else {
      unmatchedInApi++;
    }

    if (apiId && apiSraNumber && apiId !== apiSraNumber) {
      if (dbIdSet.has(apiId) && dbIdSet.has(apiSraNumber)) {
        localSraNumberWithIdRowInDb++;
      }
    }

    if (
      mismatchType !== "local_matches_api_SraNumber" &&
      mismatchType !== "local_matches_both_id_and_sra_number"
    ) {
      mismatches.push({
        localSraId,
        displayName: row.display_name,
        mismatchType,
        apiId,
        apiSraNumber,
        dbSraNumberRowExists,
        dbIdRowExists,
        apiPracticeName: practiceName,
      });
    }
  }

  return {
    sampleSize: sample.length,
    apiOrganisationCount: apiRows.length,
    localMatchesApiId,
    localMatchesApiSraNumber,
    localIdWithSraNumberRowInDb,
    localSraNumberWithIdRowInDb,
    unmatchedInApi,
    mismatches: mismatches.slice(0, sampleSize),
  };
}
