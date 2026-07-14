import { prisma } from "@/lib/db/prisma";

let knowledgeTablesAvailable: boolean | null = null;

/** True when knowledge_compiler migration has been applied. */
export async function isKnowledgeGraphDbReady(): Promise<boolean> {
  if (process.env.KNOWLEDGE_GRAPH_SKIP_DB === "1") return false;
  if (knowledgeTablesAvailable != null) return knowledgeTablesAvailable;
  try {
    await prisma.knowledgeConcept.findFirst({ select: { id: true } });
    knowledgeTablesAvailable = true;
  } catch {
    knowledgeTablesAvailable = false;
  }
  return knowledgeTablesAvailable;
}
