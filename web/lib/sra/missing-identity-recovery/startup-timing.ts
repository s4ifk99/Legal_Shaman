export const STARTUP_STAGES = [
  "beforePrismaInit",
  "afterPrismaInit",
  "beforeBatchLoad",
  "afterBatchLoad",
  "beforePaginationQuery",
  "afterPaginationQuery",
] as const;

export type StartupStage = (typeof STARTUP_STAGES)[number];

export type StartupStageRecord = {
  stage: StartupStage;
  at: string;
  elapsedMs: number;
  sincePreviousMs?: number;
};

export type StartupTiming = {
  startupDebug: boolean;
  startedAt: number;
  stages: StartupStageRecord[];
};

export function createStartupTiming(startupDebug: boolean): StartupTiming {
  return { startupDebug, startedAt: Date.now(), stages: [] };
}

function emitStartupLog(timing: StartupTiming, payload: Record<string, unknown>): void {
  const line = `${JSON.stringify(payload)}\n`;
  if (timing.startupDebug) {
    process.stdout.write(line);
  } else {
    console.info(line.trimEnd());
  }
}

/** Record and log a startup stage (always logged; --startup-debug flushes immediately). */
export function markStartupStage(
  timing: StartupTiming | undefined,
  stage: StartupStage,
  extra?: Record<string, unknown>,
): void {
  if (!timing) return;

  const now = Date.now();
  const elapsedMs = now - timing.startedAt;
  const prev = timing.stages[timing.stages.length - 1];
  const sincePreviousMs = prev !== undefined ? elapsedMs - prev.elapsedMs : undefined;

  const record: StartupStageRecord = {
    stage,
    at: new Date().toISOString(),
    elapsedMs,
    sincePreviousMs,
  };
  timing.stages.push(record);

  emitStartupLog(timing, {
    event: "sra_missing_identity_startup",
    ...record,
    ...extra,
  });
}

export function startupTimingSummary(
  timing: StartupTiming | undefined,
): { stages: StartupStageRecord[]; totalElapsedMs?: number } | undefined {
  if (!timing || timing.stages.length === 0) return undefined;
  const last = timing.stages[timing.stages.length - 1]!;
  return { stages: [...timing.stages], totalElapsedMs: last.elapsedMs };
}
