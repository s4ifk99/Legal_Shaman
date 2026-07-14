import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { loadWikiSourceConfig } from "@/lib/wiki/load-config";
import { wikiPageSlugFromRelativePath } from "@/lib/wiki/public-url";

import { isConsumerWikiPageId } from "./taxonomy-map";
import type { MergeAction } from "./types";

const LEGAL_SHAMAN_MARKER = "<!-- legal-shaman-integrated -->";

function wikiPathForPageId(wikiPagesDir: string, wikiPageId: string): string {
  return join(wikiPagesDir, `${wikiPageId}.md`);
}

function parseSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  const parts = markdown.split(/^##\s+/m);
  const preamble = parts.shift() ?? "";
  sections.set("__title__", preamble);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    if (nl === -1) {
      sections.set(part.trim(), "");
      continue;
    }
    sections.set(part.slice(0, nl).trim(), part.slice(nl + 1).trim());
  }
  return sections;
}

function renderPage(title: string, sections: Map<string, string>): string {
  const order = [
    "Summary",
    "Key Information",
    "Practical Guidance",
    "Related Concepts",
    "Related Organisations",
    "Sources",
  ];
  const lines = [`# ${title}`, ""];
  if (!sections.has("Summary") && sections.get("__integrated__")) {
    lines.push(LEGAL_SHAMAN_MARKER, "");
  }
  for (const name of order) {
    const body = sections.get(name);
    if (!body?.trim()) continue;
    lines.push(`## ${name}`, "", body.trim(), "");
  }
  return `${lines.join("\n").trim()}\n`;
}

function mergeBullets(existing: string, bullets: string[]): string {
  const current = existing
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const seen = new Set(current.map((l) => l.toLowerCase()));
  for (const b of bullets) {
    const line = b.startsWith("-") ? b : `- ${b}`;
    if (!seen.has(line.toLowerCase())) {
      current.push(line);
      seen.add(line.toLowerCase());
    }
  }
  return current.join("\n");
}

export type WikiWriteResult = {
  written: string[];
  skipped: string[];
  errors: string[];
};

export function applyMergePlan(actions: MergeAction[]): WikiWriteResult {
  const config = loadWikiSourceConfig();
  const wikiPagesDir = config.wikiPagesDir;
  const result: WikiWriteResult = { written: [], skipped: [], errors: [] };

  for (const action of actions) {
    try {
      if (action.type === "update_section") {
        if (!isConsumerWikiPageId(action.wikiPageId)) {
          result.skipped.push(action.wikiPageId);
          continue;
        }
        const path = wikiPathForPageId(wikiPagesDir, action.wikiPageId);
        if (!existsSync(path)) {
          result.errors.push(`missing page: ${action.wikiPageId}`);
          continue;
        }
        const md = readFileSync(path, "utf8");
        const sections = parseSections(md);
        const titleMatch = md.match(/^#\s+(.+)/m);
        const title = titleMatch?.[1]?.trim() ?? action.wikiPageId.split("/").pop()!;
        const existing = sections.get(action.section) ?? "";
        sections.set(action.section, mergeBullets(existing, action.bullets));
        sections.set("__integrated__", "1");
        writeFileSync(path, renderPage(title, sections), "utf8");
        result.written.push(action.wikiPageId);
      }

      if (action.type === "create_page") {
        if (!action.areaPath.startsWith("Areas/")) {
          result.skipped.push(action.title);
          continue;
        }
        const slug = action.title.replace(/[^\w\s-]/g, "").trim();
        const wikiPageId = `${action.areaPath}/${slug}`;
        const path = wikiPathForPageId(wikiPagesDir, wikiPageId);
        if (existsSync(path)) {
          result.skipped.push(wikiPageId);
          continue;
        }
        mkdirSync(dirname(path), { recursive: true });
        const sections = new Map<string, string>();
        for (const [k, v] of Object.entries(action.sections)) {
          sections.set(k, Array.isArray(v) ? v.map((b) => (b.startsWith("-") ? b : `- ${b}`)).join("\n") : v);
        }
        sections.set("__integrated__", "1");
        writeFileSync(path, renderPage(action.title, sections), "utf8");
        result.written.push(wikiPageId);
      }

      if (action.type === "append_source") {
        if (!isConsumerWikiPageId(action.wikiPageId)) continue;
        const path = wikiPathForPageId(wikiPagesDir, action.wikiPageId);
        if (!existsSync(path)) continue;
        const md = readFileSync(path, "utf8");
        const sections = parseSections(md);
        const titleMatch = md.match(/^#\s+(.+)/m);
        const title = titleMatch?.[1]?.trim() ?? "";
        const sources = sections.get("Sources") ?? "";
        if (!sources.includes(action.sourceUrl)) {
          sections.set("Sources", mergeBullets(sources, [action.sourceUrl]));
          writeFileSync(path, renderPage(title, sections), "utf8");
          result.written.push(`${action.wikiPageId}:source`);
        }
      }

      if (action.type === "add_wikilink") {
        if (!isConsumerWikiPageId(action.fromWikiPageId)) continue;
        const path = wikiPathForPageId(wikiPagesDir, action.fromWikiPageId);
        if (!existsSync(path)) continue;
        const md = readFileSync(path, "utf8");
        const sections = parseSections(md);
        const titleMatch = md.match(/^#\s+(.+)/m);
        const title = titleMatch?.[1]?.trim() ?? "";
        const related = sections.get("Related Concepts") ?? "";
        const link = `[[${action.toTitle}]]`;
        if (!related.includes(link)) {
          sections.set("Related Concepts", mergeBullets(related, [link]));
          writeFileSync(path, renderPage(title, sections), "utf8");
          result.written.push(`${action.fromWikiPageId}:link`);
        }
      }
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return result;
}

export function relativePathFromWikiPageId(wikiPageId: string): string {
  return `${wikiPageSlugFromRelativePath(wikiPageId)}.md`;
}
