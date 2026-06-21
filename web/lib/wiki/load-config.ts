import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WikiSourceConfig } from "./types";

export function loadWikiSourceConfig(): WikiSourceConfig {
  const configPath = resolve(process.cwd(), "config/wiki-source.json");
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as WikiSourceConfig;
  return raw;
}
