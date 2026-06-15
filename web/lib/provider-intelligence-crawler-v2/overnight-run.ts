import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { planWeakProviders } from "@/lib/provider-enrichment-ladder/enrichment-planner";
import {
  loadEnrichmentMap,
  loadSraIndexDocuments,
} from "@/lib/provider-enrichment-ladder/ladder-cli";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import {
  runCrawlerV2ForEntity,
} from "@/lib/provider-intelligence-crawler-v2/orchestrator";
import type { CrawlerV2RunStats, CrawlerV2Stage } from "@/lib/provider-intelligence-crawler-v2/types";

export type ProvidersOvernightOptions = {
  batchSize?: number;
  resume?: boolean;
  /** Pause between entities (ms). Default 0. */
  delayBetweenMs?: number;
  stages?: CrawlerV2Stage[];
};

export type ProvidersOvernightResult = {
  event: "providers_overnight";
  batchSize: number;
  resumedFrom?: string;
  targets: number;
  entitiesProcessed: number;
  stageRuns: number;
  runsCompleted: number;
  runsFailed: number;
  recordsWritten: number;
  autoApproved: number;
  pendingReview: number;
  rejected: number;
  checkpoint: { lastEntityId?: string; entitiesProcessedTotal: number };
};

const CHECKPOINT_DIR = path.join(process.cwd(), ".cache/providers-overnight");
const CHECKPOINT_FILE = path.join(CHECKPOINT_DIR, "checkpoint.json");
const PROGRESS_FILE = path.join(CHECKPOINT_DIR, "progress.jsonl");

type Checkpoint = {
  lastEntityId?: string;
  entitiesProcessedTotal?: number;
};

const DEFAULT_STAGES: { stage: CrawlerV2Stage; missingField: string }[] = [
  { stage: "discover_website", missingField: "website" },
  { stage: "extract_contacts", missingField: "phone" },
  { stage: "extract_practice_areas", missingField: "practiceAreaSlugs" },
];

async function ensureCheckpointDir(): Promise<void> {
  await mkdir(CHECKPOINT_DIR, { recursive: true });
}

async function loadCheckpoint(): Promise<Checkpoint> {
  try {
    return JSON.parse(await readFile(CHECKPOINT_FILE, "utf8")) as Checkpoint;
  } catch {
    return {};
  }
}

async function saveCheckpoint(cp: Checkpoint): Promise<void> {
  await mkdir(CHECKPOINT_DIR, { recursive: true });
  await writeFile(CHECKPOINT_FILE, JSON.stringify(cp, null, 2), "utf8");
}

async function appendProgress(line: Record<string, unknown>): Promise<void> {
  await mkdir(CHECKPOINT_DIR, { recursive: true });
  await writeFile(
    PROGRESS_FILE,
    `${JSON.stringify({ ts: new Date().toISOString(), ...line })}\n`,
    { flag: "a" },
  );
}

function stagesForEntity(
  missingFields: string[],
  configured: typeof DEFAULT_STAGES,
): CrawlerV2Stage[] {
  const out: CrawlerV2Stage[] = [];
  for (const row of configured) {
    if (missingFields.includes(row.missingField)) {
      out.push(row.stage);
    }
  }
  if (missingFields.includes("email") && !out.includes("extract_contacts")) {
    out.push("extract_contacts");
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runProvidersOvernight(
  opts: ProvidersOvernightOptions = {},
): Promise<ProvidersOvernightResult> {
  const batchSize = opts.batchSize ?? 1000;
  const delayBetweenMs = opts.delayBetweenMs ?? 0;

  await ensureCheckpointDir();

  let checkpoint = await loadCheckpoint();
  if (!opts.resume) {
    checkpoint = {};
  }

  const docs = await loadSraIndexDocuments();
  const enrichmentMap = await loadEnrichmentMap();
  const plans = planWeakProviders(docs, enrichmentMap, { sraOnly: true });
  const docById = new Map<string, LegalEntityDocument>(docs.map((d) => [d.id, d]));

  let ordered = plans.map((p) => p.entityId);
  if (checkpoint.lastEntityId) {
    const idx = ordered.indexOf(checkpoint.lastEntityId);
    ordered = idx >= 0 ? ordered.slice(idx + 1) : ordered;
  }

  const batchIds = ordered.slice(0, batchSize);
  const result: ProvidersOvernightResult = {
    event: "providers_overnight",
    batchSize,
    resumedFrom: checkpoint.lastEntityId,
    targets: batchIds.length,
    entitiesProcessed: 0,
    stageRuns: 0,
    runsCompleted: 0,
    runsFailed: 0,
    recordsWritten: 0,
    autoApproved: 0,
    pendingReview: 0,
    rejected: 0,
    checkpoint: {
      lastEntityId: checkpoint.lastEntityId,
      entitiesProcessedTotal: checkpoint.entitiesProcessedTotal ?? 0,
    },
  };

  for (const entityId of batchIds) {
    const doc = docById.get(entityId);
    const plan = plans.find((p) => p.entityId === entityId);
    if (!doc || !plan) continue;

    const stages = stagesForEntity(plan.missingFields, DEFAULT_STAGES);
    for (const stage of stages) {
      if (opts.stages?.length && !opts.stages.includes(stage)) continue;

      const enrichments = enrichmentMap.get(entityId) ?? [];
      const { stats } = await runCrawlerV2ForEntity(doc, stage, enrichments);
      aggregateStats(result, stats);
      result.stageRuns++;

      await appendProgress({
        entityId,
        stage,
        ok: stats.errors.length === 0,
        stats,
      });
    }

    result.entitiesProcessed++;
    checkpoint.lastEntityId = entityId;
    checkpoint.entitiesProcessedTotal = (checkpoint.entitiesProcessedTotal ?? 0) + 1;
    result.checkpoint = {
      lastEntityId: checkpoint.lastEntityId,
      entitiesProcessedTotal: checkpoint.entitiesProcessedTotal,
    };
    await saveCheckpoint(checkpoint);

    if (delayBetweenMs > 0) await sleep(delayBetweenMs);
  }

  return result;
}

function aggregateStats(batch: ProvidersOvernightResult, stats: CrawlerV2RunStats): void {
  if (stats.errors.length) batch.runsFailed++;
  else batch.runsCompleted++;
  batch.recordsWritten += stats.candidatesSubmitted;
  batch.autoApproved += stats.autoApproved;
  batch.pendingReview += stats.pendingReview;
  batch.rejected += stats.rejected;
}
