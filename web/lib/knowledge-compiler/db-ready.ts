import { prisma } from "@/lib/db/prisma";

let knowledgeTablesAvailable: boolean | null = null;

/** True when knowledge_compiler migration has been applied. */
export async function isKnowledgeGraphDbReady(): Promise<boolean> {
  if (process.env.KNOWLEDGE_GRAPH_SKIP_DB === "1") return false;
  if (knowledgeTablesAvailable != null) return knowledgeTablesAvailable;
  try {
    const probe = prisma.knowledgeConcept.findFirst({ select: { id: true } });
    const timeoutMs = Number(process.env.KNOWLEDGE_DB_PROBE_TIMEOUT_MS ?? 2_000);
    await Promise.race([
      probe,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("knowledge_db_probe_timeout")), timeoutMs);
      }),
    ]);
    knowledgeTablesAvailable = true;
  } catch {
    knowledgeTablesAvailable = false;
  }
  return knowledgeTablesAvailable;
}
