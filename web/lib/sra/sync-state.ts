import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/db/prisma";

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

async function fromCatalogue(): Promise<Pick<SraSyncState, "lastSuccessAt" | "organisationsUpserted">> {
  try {
    const agg = await prisma.sraOrganisation.aggregate({
      _max: { updatedAt: true },
      _count: true,
    });
    return {
      lastSuccessAt: agg._max.updatedAt?.toISOString() ?? null,
      organisationsUpserted: agg._count,
    };
  } catch {
    return { lastSuccessAt: null, organisationsUpserted: 0 };
  }
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
