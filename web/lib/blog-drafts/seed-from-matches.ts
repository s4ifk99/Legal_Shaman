/**
 * Seed Marketing Blog Services / Practical Guidance / What-door sections
 * from a BlogFreeHelpMatch snapshot. Editorial may enrich will/will-not text
 * but must not invent doors absent from the snapshot.
 */
import type { BlogFreeHelpMatch } from "./match-free";
import type { FreeServiceHit } from "@/lib/coherence/matchFreeServices";
import type { HelpDoor } from "@/lib/coherence/peopleFirst";

function escapeCell(s: string): string {
  return s.replace(/\|/g, "/").replace(/\n+/g, " ").trim();
}

function asHit(door: HelpDoor | FreeServiceHit, match: BlogFreeHelpMatch): FreeServiceHit {
  const found = match.freeHelp.find((h) => h.id === door.id);
  if (found) return found;
  return {
    id: door.id,
    title: door.title,
    type: "type" in door ? door.type : "",
    blurb: "blurb" in door ? door.blurb : "",
    url: door.url,
    phone: door.phone,
    score: "score" in door ? door.score : 0,
    topicKeys: "topicKeys" in door ? door.topicKeys : [],
  };
}

function reachCell(hit: FreeServiceHit): string {
  const parts: string[] = [];
  if (hit.url) parts.push(`[Open](${hit.url})`);
  if (hit.phone) parts.push(hit.phone);
  return parts.join(" · ") || "See official site";
}

/** Strip Exa/scrape dumps: "Summary:", phone trees, truncated tails. */
function cleanBlurb(raw: string): string {
  let s = (raw || "").replace(/\r/g, "").trim();
  s = s.replace(/^summary\s*:\s*/i, "");
  s = s.replace(/^[-*•]\s+/gm, "");
  // Drop lines that are mostly phone / international dial dumps
  s = s
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/^\d{3,}/.test(t)) return false;
      if (/international\s*:/i.test(t)) return false;
      if (/spectrum licensing|switchboard/i.test(t)) return false;
      if (/^mak\b/i.test(t) && t.length < 12) return false;
      return true;
    })
    .join(" ");
  s = s.replace(/\s+/g, " ").trim();
  // Drop truncated trailing fragments
  if (s.length > 180) s = `${s.slice(0, 177).replace(/\s+\S*$/, "")}…`;
  if (s.length < 20) return "";
  return s;
}

function displayDoorName(title: string): string {
  return title
    .replace(/^Contacting\s+/i, "")
    .replace(/\s*-\s*GOV\.UK$/i, "")
    .trim();
}

/** Situation-ready "what they do" copy. Prefer curated lines over scrape blurbs. */
function doStub(hit: FreeServiceHit): string {
  const t = hit.title;
  if (/citizens advice/i.test(t)) {
    return "Explain your rights, point to templates, and route you to local or specialist help";
  }
  if (/ofcom/i.test(t)) {
    return "Explain how telecoms complaints and ADR work after you complain to the provider";
  }
  if (/financial ombudsman/i.test(t)) {
    return "Look at whether a bank, insurer, or other financial firm handled a complaint fairly";
  }
  if (/moneyhelper|maps/i.test(t)) {
    return "Give free money guidance on debt, bills, and consumer finance choices";
  }
  if (/^protect\b/i.test(t)) {
    return "Advise on whistleblowing and speaking up about wrongdoing at work";
  }
  if (/free representation unit|\bfru\b/i.test(t)) {
    return "May help with advice or representation in some employment tribunal cases if you qualify";
  }
  if (/yess law/i.test(t)) {
    return "Offer low cost employment advice aimed at resolving workplace problems early";
  }
  if (/bpp|eltal/i.test(t)) {
    return "Offer an initial employment law call back from a supervised student advice line";
  }
  if (/acas/i.test(t)) {
    return "Explain workplace rights and run early conciliation before many tribunal claims";
  }
  const cleaned = cleanBlurb(hit.blurb);
  if (cleaned) return escapeCell(cleaned.charAt(0).toUpperCase() + cleaned.slice(1));
  return escapeCell(`${hit.type || "Free door"} for this situation`);
}

function doNotStub(hit: FreeServiceHit): string {
  if (/citizens advice/i.test(hit.title)) {
    return "Will not chase the other party or represent you in court";
  }
  if (/ofcom/i.test(hit.title)) {
    return "Will not rewrite your broadband contract or decide your exit fee for you";
  }
  if (/financial ombudsman/i.test(hit.title)) {
    return "Will not take a case until you complained to the firm, and will not cover every non financial dispute";
  }
  if (/ombudsman|tribunal|popla|\bias\b/i.test(`${hit.title} ${hit.type}`)) {
    return "Will not start until you used their complaint or appeal process";
  }
  if (/acas/i.test(hit.title)) {
    return "Will not be your employment tribunal advocate";
  }
  if (/protect/i.test(hit.title)) {
    return "Will not run a tips or wages claim as your solicitor";
  }
  return "Will not give paid casework or act as your solicitor";
}

function orderedDoors(match: BlogFreeHelpMatch): Array<HelpDoor | FreeServiceHit> {
  return match.doors.length ? match.doors : match.freeHelp;
}

export function servicesTableFromMatch(match: BlogFreeHelpMatch): string {
  const rows = orderedDoors(match);
  if (!rows.length) {
    return [
      "| Who helps | What they actually do | What they do not do | How to reach |",
      "| --- | --- | --- | --- |",
      "| _(match empty)_ | Re-run blog:match-free | Do not invent doors | n/a |",
    ].join("\n");
  }

  const lines = [
    "| Who helps | What they actually do | What they do not do | How to reach |",
    "| --- | --- | --- | --- |",
  ];
  for (const door of rows) {
    const hit = asHit(door, match);
    lines.push(
      `| **${escapeCell(displayDoorName(hit.title))}** | ${doStub(hit)} | ${doNotStub(hit)} | ${reachCell(hit)} |`,
    );
  }
  return lines.join("\n");
}

export function practicalGuidanceFromMatch(match: BlogFreeHelpMatch): string {
  const doors = orderedDoors(match);
  const lines: string[] = [];
  if (!doors.length) {
    lines.push("- Match returned no free doors. Fix the matcher before publishing.");
  } else {
    for (const door of doors) {
      const hit = asHit(door, match);
      const name = displayDoorName(hit.title);
      if (hit.url) {
        lines.push(`- **${name}**: [Open](${hit.url}).`);
      } else {
        lines.push(`- **${name}**: use the contact on their official page.`);
      }
    }
  }
  return lines.join("\n");
}

/** End-of-draft CTA: Ask the Shaman on the marketing home page. */
export function askShamanCtaMarkdown(): string {
  return [
    "## Next step",
    "",
    "Not sure which free door fits your facts? **[Ask the Shaman](https://www.legalshaman.com/)** on the Legal Shaman home page. Describe the situation once and get the next step.",
  ].join("\n");
}

export function whatDoorSectionsFromMatch(match: BlogFreeHelpMatch): string {
  const doors = orderedDoors(match);
  if (!doors.length) return "";
  const blocks: string[] = [];
  for (const door of doors.slice(0, 6)) {
    const hit = asHit(door, match);
    const name = displayDoorName(hit.title.replace(/^the\s+/i, ""));
    blocks.push(
      [
        `## What ${name} would actually do here`,
        "",
        `${doStub(hit)}.`,
        "",
        `What they will **not** do: ${doNotStub(hit)}.`,
      ].join("\n"),
    );
  }
  return blocks.join("\n\n");
}

export function relatedOrgsFromMatch(match: BlogFreeHelpMatch): string {
  const doors = orderedDoors(match);
  if (!doors.length) return "- [[Citizens Advice]]";
  return doors
    .slice(0, 8)
    .map((d) => `- [[${displayDoorName(d.title)}]]`)
    .join("\n");
}

function stripWhatDoorSections(md: string): string {
  return md.replace(/\n## What .+ would actually do here\n[\s\S]*?(?=\n## )/gi, "\n");
}

function upsertSection(md: string, title: string, content: string): string {
  const re = new RegExp(`(##\\s*${title}\\s*\\n)([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
  if (re.test(md)) {
    return md.replace(re, `## ${title}\n\n${content.trim()}\n\n`);
  }
  const anchor = md.search(/\n##\s*(FAQ|Sources|Related Concepts|Related Organisations|Disclaimer)\b/i);
  if (anchor >= 0) {
    return `${md.slice(0, anchor)}\n\n## ${title}\n\n${content.trim()}\n${md.slice(anchor)}`;
  }
  return `${md.trim()}\n\n## ${title}\n\n${content.trim()}\n`;
}

function insertAfterKeyInformation(md: string, block: string): string {
  if (!block.trim()) return md;
  const ki = md.search(/\n##\s*Key [Ii]nformation\b/);
  if (ki < 0) {
    return upsertSection(md, "Key Information", `- See the summary.\n\n${block}`);
  }
  const rest = md.slice(ki + 1);
  const nextH2 = rest.search(/\n##\s/);
  const endKi = nextH2 >= 0 ? ki + 1 + nextH2 : md.length;
  return `${md.slice(0, endKi).trimEnd()}\n\n${block.trim()}\n${md.slice(endKi)}`;
}

function injectMatchQaNote(md: string, match: BlogFreeHelpMatch): string {
  if (match.qa === "ok") return md;
  const note = `> **Match QA (${match.qa}):** ${match.qaDetail}. Services below are from \`match_free_help\` only.\n\n`;
  // Drop prior Match QA notes
  let next = md.replace(/^>\s*\*\*Match QA[\s\S]*?\n\n/m, "");
  if (/^>\s*\*\*Status:\*\*/m.test(next)) {
    const statusEnd = next.search(/\n(?!>)/);
    if (statusEnd > 0) {
      return `${next.slice(0, statusEnd).trimEnd()}\n\n${note}${next.slice(statusEnd).replace(/^\n+/, "")}`;
    }
  }
  return note + next;
}

/**
 * Keep process bullets (provider / ACAS / bank) and replace only matcher door lines.
 */
function refreshPracticalDoorLines(md: string, match: BlogFreeHelpMatch): string {
  const re = /(##\s*Practical Guidance\s*\n)([\s\S]*?)(?=\n##\s|$)/i;
  const m = md.match(re);
  if (!m) return upsertSection(md, "Practical Guidance", practicalGuidanceFromMatch(match));

  const body = m[2];
  const processLines = body
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => {
      const t = l.trim();
      if (!t.startsWith("-")) return false;
      // Drop old door bullets (Name: start here / Open)
      if (/\*\*[^*]+\*\*\s*:\s*(start here\.?\s*)?\[Open\]/i.test(t)) return false;
      if (/\*\*[^*]+\*\*\s*:\s*use the contact on their official page/i.test(t)) return false;
      // Drop door titles that match the snapshot
      for (const door of orderedDoors(match)) {
        const name = displayDoorName(door.title).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`\\*\\*${name}\\*\\*`, "i").test(t)) return false;
        if (/Contacting Ofcom/i.test(t) && /ofcom/i.test(door.title)) return false;
      }
      return true;
    });

  const content = [...processLines, practicalGuidanceFromMatch(match)].filter(Boolean).join("\n");
  return upsertSection(md, "Practical Guidance", content);
}

/**
 * Proofread pass: clean What-door / Services / Related Orgs / Practical door lines
 * without wiping editorial process steps.
 */
export function proofreadDraftBodyFromMatch(body: string, match: BlogFreeHelpMatch): string {
  let next = body.replace(/\r\n/g, "\n");
  next = stripWhatDoorSections(next);
  next = insertAfterKeyInformation(next, whatDoorSectionsFromMatch(match));
  next = refreshPracticalDoorLines(next, match);
  next = upsertSection(next, "Services", servicesTableFromMatch(match));
  next = upsertSection(next, "Related Organisations", relatedOrgsFromMatch(match));
  next = next.replace(/\n## Next step\n[\s\S]*?(?=\n## )/g, "\n");
  if (/\n## Disclaimer\b/i.test(next)) {
    next = next.replace(/\n## Disclaimer\b/i, `\n${askShamanCtaMarkdown()}\n\n## Disclaimer`);
  } else {
    next = `${next.trim()}\n\n${askShamanCtaMarkdown()}\n`;
  }
  return `${next.replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/**
 * Replace or insert Services, Practical Guidance, What-door, Related Organisations
 * from the match snapshot. Preserves SEO, Summary, Key Information, FAQ, Sources, Disclaimer.
 */
export function seedDraftBodyFromMatch(body: string, match: BlogFreeHelpMatch): string {
  let next = injectMatchQaNote(body.replace(/\r\n/g, "\n"), match);
  next = stripWhatDoorSections(next);
  next = insertAfterKeyInformation(next, whatDoorSectionsFromMatch(match));
  next = upsertSection(next, "Practical Guidance", practicalGuidanceFromMatch(match));
  next = upsertSection(next, "Services", servicesTableFromMatch(match));
  next = upsertSection(next, "Related Organisations", relatedOrgsFromMatch(match));
  // Always end with home-page Ask the Shaman CTA (before Disclaimer if present).
  next = next.replace(/\n## Next step\n[\s\S]*?(?=\n## )/g, "\n");
  if (/\n## Disclaimer\b/i.test(next)) {
    next = next.replace(/\n## Disclaimer\b/i, `\n${askShamanCtaMarkdown()}\n\n## Disclaimer`);
  } else {
    next = `${next.trim()}\n\n${askShamanCtaMarkdown()}\n`;
  }
  return `${next.replace(/\n{3,}/g, "\n\n").trim()}\n`;
}
