/**
 * Offline free-door matching for who-helps drafts.
 * Product test of match_free_help — no SRA, no LLM, no Exa.
 */
import fs from "node:fs";
import path from "node:path";
import { createInitialSession, senseDetails } from "@/lib/coherence/sense";
import { matchingSessionForHelp } from "@/lib/coherence/services";
import { match_free_help } from "@/lib/coherence/helpTools";
import {
  classifyHelpDoorKind,
  rankPeopleFirst,
  type HelpDoor,
} from "@/lib/coherence/peopleFirst";
import type { FreeServiceHit } from "@/lib/coherence/matchFreeServices";
import type { MatterType } from "@/lib/coherence/types";
import { applyPackClassification, heuristicSuggestPack } from "@/lib/coherence/packClassifier";
export { normalizeWhoHelpsQuery } from "@/lib/coherence/normalizeWhoHelpsQuery";

export type MatchQa = "ok" | "weak" | "empty";

export type BlogFreeHelpMatch = {
  query: string;
  title: string;
  matter: string;
  matterType: MatterType | "unknown";
  freeHelp: FreeServiceHit[];
  doors: HelpDoor[];
  matchOk: boolean;
  qa: MatchQa;
  qaDetail: string;
  generatedAt: string;
};

const ROOT = path.join(process.cwd(), "data", "blog-drafts");

const CAB_ONLY_RE = /citizens advice/i;

export function matchFileStem(draftFile: string): string {
  return draftFile.replace(/\.md$/i, "");
}

export function matchSnapshotPath(date: string, draftFile: string): string {
  return path.join(ROOT, date, "matches", `${matchFileStem(draftFile)}.json`);
}

function assessQa(freeHelp: FreeServiceHit[]): { qa: MatchQa; matchOk: boolean; qaDetail: string } {
  if (freeHelp.length === 0) {
    return { qa: "empty", matchOk: false, qaDetail: "No freeHelp hits from match_free_help" };
  }
  const nonCab = freeHelp.filter((h) => !CAB_ONLY_RE.test(h.title));
  if (nonCab.length === 0 && freeHelp.length <= 2) {
    return {
      qa: "weak",
      matchOk: false,
      qaDetail: "Only Citizens Advice style hits — likely under-matched for the situation",
    };
  }
  if (freeHelp.length < 2) {
    return { qa: "weak", matchOk: false, qaDetail: `Only ${freeHelp.length} free door(s)` };
  }
  return {
    qa: "ok",
    matchOk: true,
    qaDetail: `${freeHelp.length} free doors (${nonCab.length} non-CAB)`,
  };
}

/**
 * Run the advertised offline matcher on a who-helps situation.
 */
export function matchFreeDoorsForSituation(input: {
  title: string;
  matter?: string;
  story?: string;
}): BlogFreeHelpMatch {
  const title = input.title.replace(/\?+$/, "").trim();
  const story =
    (input.story || "").trim() ||
    `${title}. England. Who helps with the free doors for this situation?`;

  let session = createInitialSession();
  session = senseDetails(story, session);
  const pack = heuristicSuggestPack(story);
  session = applyPackClassification(session, pack);
  if (input.matter && session.matterType === "unknown") {
    const map: Record<string, MatterType> = {
      consumer: "consumer",
      parking: "consumer",
      employment: "employment",
      housing: "housing",
      neighbours: "housing",
      crime: "crime",
      other: "other",
    };
    const forced = map[input.matter];
    if (forced) session = { ...session, matterType: forced };
  }

  const helpSession = matchingSessionForHelp(session);
  const freeHelp = match_free_help(helpSession, 8);
  const doors = rankPeopleFirst(
    freeHelp.map((h) => ({
      id: h.id,
      title: h.title,
      kind: classifyHelpDoorKind(h.title, h.type, "match_free_help"),
      blurb: h.blurb,
      url: h.url,
      phone: h.phone,
      tool: "match_free_help" as const,
    })),
  );
  const { qa, matchOk, qaDetail } = assessQa(freeHelp);

  return {
    query: story,
    title,
    matter: input.matter || session.matterType,
    matterType: session.matterType,
    freeHelp,
    doors,
    matchOk,
    qa,
    qaDetail,
    generatedAt: new Date().toISOString(),
  };
}

export function writeMatchSnapshot(date: string, draftFile: string, match: BlogFreeHelpMatch): string {
  const outPath = matchSnapshotPath(date, draftFile);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(match, null, 2)}\n`, "utf8");
  return outPath;
}

export function readMatchSnapshot(date: string, draftFile: string): BlogFreeHelpMatch | null {
  const p = matchSnapshotPath(date, draftFile);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as BlogFreeHelpMatch;
}

/** Pull anonymised Legal Shaman query from a draft body when present. */
export function anonymisedQueryFromDraft(body: string): string | null {
  const m = body.match(
    /##\s*Anonymised Legal Shaman query\s*\n+([\s\S]*?)(?=\n##\s|\n---\s*$|$)/i,
  );
  if (!m) return null;
  return m[1]
    .replace(/^>\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim() || null;
}
