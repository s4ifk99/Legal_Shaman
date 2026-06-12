import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";

import type { SraCoverageMetrics } from "@/lib/sra/sra-sync-coverage";

export const SRA_SYNC_CHECKPOINT_INTERVAL = 500;

export type SraSyncCheckpoint = {
  version: 2;
  lastSuccessfulSraNumber: string | null;
  processedCount: number;
  runStartedAt: string;
  checkpointAt: string;
  beforeMetrics?: SraCoverageMetrics;
};

const CHECKPOINT_PATH = path.join(process.cwd(), ".sra-sync-checkpoint.json");

export function sraSyncCheckpointPath(): string {
  return CHECKPOINT_PATH;
}

export async function readSraSyncCheckpoint(): Promise<SraSyncCheckpoint | null> {
  try {
    const raw = await readFile(CHECKPOINT_PATH, "utf8");
    return JSON.parse(raw) as SraSyncCheckpoint;
  } catch {
    return null;
  }
}

export async function writeSraSyncCheckpoint(checkpoint: SraSyncCheckpoint): Promise<void> {
  await mkdir(path.dirname(CHECKPOINT_PATH), { recursive: true });
  await writeFile(CHECKPOINT_PATH, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

export async function clearSraSyncCheckpoint(): Promise<void> {
  try {
    await unlink(CHECKPOINT_PATH);
  } catch {
    // no checkpoint yet
  }
}
