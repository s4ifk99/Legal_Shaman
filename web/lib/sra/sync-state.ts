import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type SraSyncState = {
  lastSuccessAt: string | null;
  organisationsUpserted: number;
  errors: string[];
  apiConfigured: boolean;
};

const STATE_PATH = path.join(process.cwd(), ".sra-sync-state.json");

export async function readSraSyncState(): Promise<SraSyncState> {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    return JSON.parse(raw) as SraSyncState;
  } catch {
    return {
      lastSuccessAt: null,
      organisationsUpserted: 0,
      errors: [],
      apiConfigured: Boolean(process.env.SRA_APIM_SUBSCRIPTION_KEY?.trim()),
    };
  }
}

export async function writeSraSyncState(state: Partial<SraSyncState>): Promise<void> {
  const prev = await readSraSyncState();
  const next: SraSyncState = {
    ...prev,
    ...state,
    apiConfigured: Boolean(process.env.SRA_APIM_SUBSCRIPTION_KEY?.trim()),
  };
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
