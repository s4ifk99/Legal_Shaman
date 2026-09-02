import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/db/prisma";
import { LEGAL_ENTITIES_COLLECTION } from "@/lib/search-index/config";
import { buildTypesenseListingsClientFromEnv } from "@/lib/search/typesense-listings-client";

export type SraSyncState = {
  lastSuccessAt: string | null;
  organisationsUpserted: number;
  /** Count of organisations in the latest successful GetAll fetch. */
  activeGetAllCount?: number;
  errors: string[];
  apiConfigured: boolean;
  /** Set when the last run used `sra:sync -- --limit=N`. */
  partialSyncLimit?: number;
};

const STATE_PATH = path.join(process.cwd(), ".sra-sync-state.json");

function apiConfigured(): boolean {
  return Boolean(process.env.SRA_APIM_SUBSCRIPTION_KEY?.trim());
}

async function readFileState(): Promise<SraSyncState | null> {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    return JSON.parse(raw) as SraSyncState;
  } catch {
    return null;
  }
}

async function fromTypesense(): Promise<Pick<SraSyncState, "lastSuccessAt" | "organisationsUpserted">> {
  const client = buildTypesenseListingsClientFromEnv();
  if (!client) return { lastSuccessAt: null, organisationsUpserted: 0 };
  try {
    const res = await client.collections(LEGAL_ENTITIES_COLLECTION).documents().search({
      q: "*",
      query_by: "title",
      filter_by: "entityType:=`sra_organisation`",
      sort_by: "updatedAt:desc",
      per_page: 1,
    });
    const found = (res as { found?: number }).found ?? 0;
    const raw = (res.hits?.[0]?.document as { updatedAt?: number } | undefined)?.updatedAt;
    let lastSuccessAt: string | null = null;
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      const ms = raw > 1e12 ? raw : raw * 1000;
      lastSuccessAt = new Date(ms).toISOString();
    }
    return { lastSuccessAt, organisationsUpserted: found };
  } catch {
    return { lastSuccessAt: null, organisationsUpserted: 0 };
  }
}

async function fromCatalogue(): Promise<Pick<SraSyncState, "lastSuccessAt" | "organisationsUpserted">> {
  try {
    const agg = await prisma.sraOrganisation.aggregate({
      _max: { updatedAt: true },
      _count: true,
    });
    if (agg._max.updatedAt) {
      return {
        lastSuccessAt: agg._max.updatedAt.toISOString(),
        organisationsUpserted: agg._count,
      };
    }
  } catch {
    // Vercel often has no SRA rows on DATABASE_URL; Typesense is the live index.
  }
  return fromTypesense();
}

export async function readSraSyncState(): Promise<SraSyncState> {
  const file = await readFileState();
  const configured = apiConfigured();
  if (file?.lastSuccessAt) {
    return { ...file, apiConfigured: configured };
  }
  const catalogue = await fromCatalogue();
  return {
    lastSuccessAt: catalogue.lastSuccessAt,
    organisationsUpserted: file?.organisationsUpserted || catalogue.organisationsUpserted,
    activeGetAllCount: file?.activeGetAllCount,
    errors: file?.errors ?? [],
    apiConfigured: configured,
    partialSyncLimit: file?.partialSyncLimit,
  };
}

export async function writeSraSyncState(state: Partial<SraSyncState>): Promise<void> {
  const prev = await readSraSyncState();
  const next: SraSyncState = {
    ...prev,
    ...state,
    apiConfigured: apiConfigured(),
  };
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
