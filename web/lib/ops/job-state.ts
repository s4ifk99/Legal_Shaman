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
  guidanceSelfAudit: OpsJobRunRecord | null;
};

const STATE_PATH = path.join(process.cwd(), ".ops-job-state.json");

export async function readOpsJobState(): Promise<OpsJobStateFile> {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<OpsJobStateFile>;
    return {
      daily: parsed.daily ?? null,
      weekly: parsed.weekly ?? null,
      refreshApproved: parsed.refreshApproved ?? null,
      guidanceSelfAudit: parsed.guidanceSelfAudit ?? null,
    };
  } catch {
    return { daily: null, weekly: null, refreshApproved: null, guidanceSelfAudit: null };
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
