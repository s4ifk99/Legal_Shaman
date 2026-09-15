#!/usr/bin/env tsx
/**
 * Messy-dispute eval — classify + match on raw UK stories.
 *
 * Offline. No LLM. If mixed housing/police fails, we are a demo, not an agent.
 *
 *   npm run test:messy-disputes
 *   npm run test:messy-disputes -- --json
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInitialSession, senseDetails } from "../lib/coherence/sense";
import {
  applyPackClassification,
  heuristicSuggestPack,
  type CoherencePackId,
} from "../lib/coherence/packClassifier";
import { classifyUkTaxonomy } from "../lib/coherence/ukTaxonomy";
import { proposeCoherentFrames } from "../lib/coherence/frames";
import { matchingSessionForHelp } from "../lib/coherence/services";
import { matchFreeServices } from "../lib/coherence/matchFreeServices";
import { matchAuthorityHelp } from "../lib/coherence/matchAuthorityHelp";
import { freezeIssueGraph } from "../lib/coherence/freezeIssueGraph";
import {
  classifyHelpDoorKind,
  match_free_help,
  rankPeopleFirst,
  recordHelpOutcome,
} from "../lib/coherence/helpTools";
import { resolveLiveDispute } from "../lib/matter/liveDispute";
import type { MatterType } from "../lib/coherence/types";

type Case = {
  id: string;
  story: string;
  expectMatter?: MatterType;
  expectMatterIn?: MatterType[];
  expectPackIn?: CoherencePackId[];
  forbidPack?: CoherencePackId[];
  expectTaxonomyReasonsAny?: string[];
  expectTaxonomyReasonsAnyPolice?: string[];
  forbidTaxonomyReasons?: string[];
  expectFrameIdAny?: string[];
  expectFreeHelpAny?: string[];
  forbidFreeHelp?: string[];
  expectLiveDispute?: string | null;
  followUp?: string;
  expectFrozenMatter?: MatterType;
  expectPeopleFirstNotFirm?: boolean;
};

type Fixture = { cases: Case[] };

type Check = { ok: boolean; detail: string };

const asJson = process.argv.includes("--json");

function includesAny(hay: string, needles: string[]): boolean {
  const h = hay.toLowerCase();
  return needles.some((n) => h.includes(n.toLowerCase()));
}

function fail(detail: string): Check {
  return { ok: false, detail };
}

function pass(detail: string): Check {
  return { ok: true, detail };
}

function runCase(c: Case): { id: string; ok: boolean; checks: Check[] } {
  let session = createInitialSession();
  session = senseDetails(c.story, session);
  const pack = heuristicSuggestPack(c.story);
  session = applyPackClassification(session, pack);
  const tax = classifyUkTaxonomy(c.story);
  const frames = proposeCoherentFrames(session, 6);
  const helpSession = matchingSessionForHelp(session);
  const free = matchFreeServices(helpSession, 8);
  const authority = matchAuthorityHelp(helpSession, 8);
  const live = resolveLiveDispute(c.story);
  const freeBlob = free.map((h) => `${h.title} ${h.blurb}`).join(" | ");
  const authorityBlob = [...authority.official, ...authority.firms]
    .map((h) => h.title)
    .join(" | ");
  const matchBlob = `${freeBlob} ${authorityBlob}`;
  const reasons = tax?.reasons || [];
  const checks: Check[] = [];

  if (c.expectMatter) {
    checks.push(
      session.matterType === c.expectMatter
        ? pass(`matter=${session.matterType}`)
        : fail(`matter=${session.matterType} expected ${c.expectMatter}`),
    );
  }
  if (c.expectMatterIn?.length) {
    checks.push(
      c.expectMatterIn.includes(session.matterType)
        ? pass(`matter=${session.matterType}`)
        : fail(`matter=${session.matterType} expected one of ${c.expectMatterIn.join(",")}`),
    );
  }
  if (c.expectPackIn?.length) {
    checks.push(
      c.expectPackIn.includes(pack.packId)
        ? pass(`pack=${pack.packId}`)
        : fail(`pack=${pack.packId} expected one of ${c.expectPackIn.join(",")}`),
    );
  }
  if (c.forbidPack?.length) {
    checks.push(
      !c.forbidPack.includes(pack.packId)
        ? pass(`pack not forbidden (${pack.packId})`)
        : fail(`pack=${pack.packId} is forbidden`),
    );
  }
  if (c.expectTaxonomyReasonsAny?.length) {
    checks.push(
      c.expectTaxonomyReasonsAny.some((r) => reasons.includes(r))
        ? pass(`taxonomy reasons hit housing: ${reasons.join("; ")}`)
        : fail(`taxonomy reasons missing housing label: ${reasons.join("; ") || "(none)"}`),
    );
  }
  if (c.expectTaxonomyReasonsAnyPolice?.length) {
    checks.push(
      c.expectTaxonomyReasonsAnyPolice.some((r) => reasons.includes(r))
        ? pass(`taxonomy still sees police: ${reasons.join("; ")}`)
        : fail(`taxonomy dropped police on mixed story: ${reasons.join("; ") || "(none)"}`),
    );
  }
  if (c.forbidTaxonomyReasons?.length) {
    const hit = c.forbidTaxonomyReasons.filter((r) => reasons.includes(r));
    checks.push(
      hit.length === 0
        ? pass("taxonomy did not take the wrong playbook")
        : fail(`taxonomy wrongly included ${hit.join(", ")}`),
    );
  }
  if (c.expectFrameIdAny?.length) {
    const ids = frames.map((f) => f.id);
    checks.push(
      c.expectFrameIdAny.some((id) => ids.includes(id))
        ? pass(`frames=${ids.join(",")}`)
        : fail(`frames=${ids.join(",") || "(none)"} missing ${c.expectFrameIdAny.join("|")}`),
    );
  }
  if (c.expectFreeHelpAny?.length) {
    checks.push(
      includesAny(matchBlob, c.expectFreeHelpAny)
        ? pass("match hit expected door")
        : fail(`match missed ${c.expectFreeHelpAny.join("|")}: ${matchBlob.slice(0, 220)}`),
    );
  }
  if (c.forbidFreeHelp?.length) {
    const bad = c.forbidFreeHelp.filter((n) => includesAny(matchBlob, [n]));
    checks.push(
      bad.length === 0
        ? pass("match did not bleed to the wrong door")
        : fail(`match leaked ${bad.join(", ")}: ${matchBlob.slice(0, 220)}`),
    );
  }
  if (c.expectLiveDispute !== undefined) {
    const kind = live?.kind || null;
    checks.push(
      kind === c.expectLiveDispute
        ? pass(`liveDispute=${kind || "none"}`)
        : fail(`liveDispute=${kind || "none"} expected ${c.expectLiveDispute}`),
    );
  }

  const frozen = freezeIssueGraph(session);
  if (c.expectFrozenMatter || c.followUp || c.expectPeopleFirstNotFirm) {
    checks.push(
      frozen.issueGraphFrozen
        ? pass("issue graph frozen")
        : fail("issue graph did not freeze"),
    );
    const help = matchingSessionForHelp(frozen);
    if (c.expectFrozenMatter) {
      checks.push(
        help.matterType === c.expectFrozenMatter
          ? pass(`frozen matter=${help.matterType}`)
          : fail(`frozen matter=${help.matterType} expected ${c.expectFrozenMatter}`),
      );
    }
    if (c.followUp) {
      const after = senseDetails(c.followUp, frozen);
      checks.push(
        after.issueGraphFrozen
          ? pass("follow-up kept freeze")
          : fail("follow-up unfroze the issue graph"),
      );
      if (c.expectFrozenMatter) {
        checks.push(
          after.matterType === c.expectFrozenMatter
            ? pass(`follow-up matter stayed ${after.matterType}`)
            : fail(`follow-up reclassified to ${after.matterType}`),
        );
      }
    }
    if (c.expectPeopleFirstNotFirm) {
      const peopleFree = match_free_help(frozen, 8);
      const doors = rankPeopleFirst(
        peopleFree.map((h) => ({
          id: h.id,
          title: h.title,
          kind: classifyHelpDoorKind(h.title, h.type, "match_free_help"),
          blurb: h.blurb,
          url: h.url,
          phone: h.phone,
          tool: "match_free_help" as const,
        })),
      );
      const first = doors[0];
      checks.push(
        first && first.kind !== "firm"
          ? pass(`people-first door=${first.kind} ${first.title}`)
          : fail(`people-first lost: ${first ? `${first.kind} ${first.title}` : "(none)"}`),
      );
    }
    const refused = recordHelpOutcome(frozen, { consent: false, result: "got_appointment" });
    checks.push(
      !refused.helpOutcome?.result
        ? pass("outcome without consent is not recorded")
        : fail("outcome persisted without consent"),
    );
  }

  return { id: c.id, ok: checks.every((x) => x.ok), checks };
}

function main() {
  const path = join(process.cwd(), "data/coherence/eval/messy-disputes.json");
  const fixture = JSON.parse(readFileSync(path, "utf8")) as Fixture;
  const results = fixture.cases.map(runCase);
  const failed = results.filter((r) => !r.ok);

  if (asJson) {
    console.log(JSON.stringify({ failed: failed.length, results }, null, 2));
  } else {
    for (const r of results) {
      console.log(r.ok ? `ok  ${r.id}` : `FAIL ${r.id}`);
      if (!r.ok) {
        for (const c of r.checks.filter((x) => !x.ok)) {
          console.log(`    - ${c.detail}`);
        }
      }
    }
    console.log(
      failed.length
        ? `\n${failed.length}/${results.length} messy disputes failed. Classify + match is still a demo on those stories.`
        : `\n${results.length} messy disputes passed (offline classify + match).`,
    );
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main();
