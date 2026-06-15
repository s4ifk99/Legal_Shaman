import Module from "node:module";

type NodeLoad = (request: string, parent: unknown, isMain: boolean) => unknown;
const nodeModule = Module as typeof Module & { _load: NodeLoad };
const load = nodeModule._load;
nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return load(request, parent, isMain);
};

export async function runOptionalPrismaEvalWithStub(): Promise<number> {
  const { runOptionalPrismaEval } = await import("../lib/search-eval/optional-prisma-eval");
  return runOptionalPrismaEval();
}
