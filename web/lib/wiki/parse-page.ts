import { basename, relative } from "node:path";
import type { WikiPageIndex } from "./types";

const SECTION_NAMES = [
  "Summary",
  "Key Information",
  "Practical Guidance",
  "Related Concepts",
  "Related Organisations",
  "Sources",
] as const;

type SectionName = (typeof SECTION_NAMES)[number];

function extractTitle(markdown: string, fileName: string): string {
  const match = markdown.match(/^#\s+(.+?)\s*$/m);
  if (match?.[1]) return match[1].trim();
  return fileName.replace(/\.md$/i, "");
}

function splitSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  const parts = markdown.split(/^##\s+/m);
  const preamble = parts.shift() ?? "";
  sections.set("__preamble__", preamble);

  for (const part of parts) {
    const newline = part.indexOf("\n");
    if (newline === -1) {
      sections.set(part.trim(), "");
      continue;
    }
    const heading = part.slice(0, newline).trim();
    const body = part.slice(newline + 1).trim();
    sections.set(heading, body);
  }

  return sections;
}

function normalizeSectionKey(heading: string): SectionName | null {
  const normalized = heading.trim().toLowerCase();
  for (const name of SECTION_NAMES) {
    if (name.toLowerCase() === normalized) return name;
  }
  return null;
}

function parseBulletLines(body: string): string[] {
  return body
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^-\s+/, "").trim())
    .filter(Boolean);
}

function parseWikilinks(body: string): string[] {
  const links = new Set<string>();
  for (const match of body.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const label = match[1]?.trim();
    if (label) links.add(label);
  }
  return [...links];
}

function sectionText(sections: Map<string, string>, name: SectionName): string {
  for (const [heading, body] of sections) {
    if (normalizeSectionKey(heading) === name) {
      return body.replace(/\n+/g, " ").trim();
    }
  }
  return "";
}

function sectionBullets(sections: Map<string, string>, name: SectionName): string[] {
  for (const [heading, body] of sections) {
    if (normalizeSectionKey(heading) === name) {
      return parseBulletLines(body);
    }
  }
  return [];
}

function sectionLinks(sections: Map<string, string>, name: SectionName): string[] {
  for (const [heading, body] of sections) {
    if (normalizeSectionKey(heading) === name) {
      const bullets = parseBulletLines(body);
      const fromBullets = bullets.flatMap((line) => {
        const links = [...line.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]!.trim());
        return links.length ? links : [line];
      });
      const inline = parseWikilinks(body);
      return [...new Set([...fromBullets, ...inline])];
    }
  }
  return [];
}

export function parseWikiPage(
  absolutePath: string,
  wikiPagesDir: string,
  content: string,
): WikiPageIndex {
  const relativePath = relative(wikiPagesDir, absolutePath).replace(/\\/g, "/");
  const category = relativePath.includes("/")
    ? (relativePath.split("/")[0] ?? "wiki")
    : "wiki";
  const fileName = basename(absolutePath);
  const sections = splitSections(content);
  const title = extractTitle(content, fileName);
  const id = relativePath.replace(/\.md$/i, "");

  return {
    id,
    title,
    filePath: absolutePath,
    relativePath,
    category,
    summary: sectionText(sections, "Summary"),
    keyInformation: sectionBullets(sections, "Key Information"),
    practicalGuidance: sectionBullets(sections, "Practical Guidance"),
    relatedConcepts: sectionLinks(sections, "Related Concepts"),
    relatedOrganisations: sectionLinks(sections, "Related Organisations"),
    sources: sectionBullets(sections, "Sources"),
    content,
  };
}
