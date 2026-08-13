/**
 * Dynamic imports of Coherence R&D agent modules (via server-scripts symlink).
 * Uses Function() so Turbopack does not try to bundle the path expression.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ensureCoherenceServerEnv } from "@/lib/coherence/config";

function scriptsLib(file: string): string {
  return path.join(process.cwd(), "lib/coherence/server-scripts/lib", file);
}

async function importAgent<T>(file: string): Promise<T> {
  ensureCoherenceServerEnv();
  const href = pathToFileURL(scriptsLib(file)).href;
  // Bypass bundler static analysis of dynamic import targets.
  const load = new Function("u", "return import(u)") as (u: string) => Promise<T>;
  return load(href);
}

export async function loadMasterOrchestrate() {
  return importAgent<{
    masterOrchestrate: (opts: Record<string, unknown>) => Promise<unknown>;
  }>("master-orchestrate.mjs");
}

export async function loadBriefAgent() {
  return importAgent<{
    understandBriefWithLlm: (
      latestText: string,
      session: Record<string, unknown>,
    ) => Promise<unknown>;
    understandBriefHeuristic: (
      latestText: string,
      session: Record<string, unknown>,
    ) => unknown;
  }>("brief-agent.mjs");
}

export async function loadLlmOrchestrate() {
  return importAgent<{
    orchestrateIntake: (opts: Record<string, unknown>) => Promise<{
      timeline?: unknown;
      snippets?: unknown;
      prompt?: unknown;
      model?: string;
    } | null>;
  }>("llm-orchestrate.mjs");
}

export async function loadAgents() {
  return importAgent<{
    runBriefAgent: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
    runTaxonomyAgent: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
    runMatterResolutionAgent: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
    runRetrieveAgent: (opts: Record<string, unknown>) => {
      agent: string;
      snippets: unknown[];
      layers: string[];
      frames?: unknown[];
    };
    runAnswerAgent: (opts: Record<string, unknown>) => Promise<{
      agent: string;
      topicId: string;
      package: Record<string, unknown>;
    }>;
    runHelpMatchAgent: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
  }>("agents.mjs");
}
