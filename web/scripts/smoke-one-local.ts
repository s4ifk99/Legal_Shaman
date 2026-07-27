import "./load-dotenv";
import Module from "node:module";
const nm = Module as typeof Module & { _load: Function };
const load = nm._load;
nm._load = function (r: string, p: unknown, m: boolean) {
  if (r === "server-only") return {};
  return load(r, p, m);
};

const q = process.argv[2] ?? "Neighbour extension issues, likely no building regs compliance (England). A friend of mine is in a semi detached house where her neighbour has built a shoddy extension";

async function main() {
  const { runLegalKnowledgeSearch } = await import("../lib/legal-knowledge/search");
  const local = await runLegalKnowledgeSearch({ query: q, includeDirectory: false });
  console.log("LOCAL", local.sources.slice(0, 4).map((s) => s.title));
  console.log((local.answer || "").slice(0, 160));
}

main().catch(console.error);
