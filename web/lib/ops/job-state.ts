import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type OpsJobRunRecord = {
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string;
  steps?: { name: string; ok: boolean; detail?: string }[];
  errors?: string[];
};

export type OpsJobStateFile = {
  daily: OpsJobRunRecord | null;
  weekly: OpsJobRunRecord | null;
  refreshApproved: OpsJobRunRecord | null;
};

const STATE_PATH = path.join(process.cwd(), ".ops-job-state.json");

export async function readOpsJobState(): Promise<OpsJobStateFile> {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    return JSON.parse(raw) as OpsJobStateFile;
  } catch {
    return { daily: null, weekly: null, refreshApproved: null };
  }
}

export async function writeOpsJobRun(
  key: keyof OpsJobStateFile,
  record: OpsJobRunRecord,
): Promise<void> {
  const prev = await readOpsJobState();
  const next: OpsJobStateFile = { ...prev, [key]: record };
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
