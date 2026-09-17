/**
 * Smoke: chronology mapping + share token hashing (no database).
 * Run: cd web && npx tsx scripts/chronology-share-smoke.ts
 */
import assert from "node:assert/strict";

import { createInitialSession } from "@/lib/coherence/sense";
import { buildLawyerBrief, buildSolicitorBrief } from "@/lib/coherence/brief";
import { inferredTimelineEvent } from "@/lib/coherence/timelineExtract";
import { hashShareToken, shareIsReadable } from "@/lib/coherence/share/crypto";
import { originFromRequest, shareNotesUrl, tokenFromShareUrl } from "@/lib/coherence/share/urls";
import { sortTimelineEventsByDate } from "@/lib/coherence/timelineDates";

const session = createInitialSession();
session.whatHappened = "The landlord served a section 21 notice.";
session.rawInputs = [
  "My landlord posted a section 21 through the door last March. I still live there with my kids.",
];
session.goal = "Keep the tenancy";
session.jurisdiction = "EnglandWales";
session.events = [
  inferredTimelineEvent({
    label: "Section 21 served",
    rawSpan: "The landlord served a section 21 notice in March 2024.",
    dateApprox: "March 2024",
    actors: ["landlord"],
    documentLabels: ["section 21 notice"],
  }),
  inferredTimelineEvent({
    label: "Client emailed landlord",
    dateApprox: "April 2024",
    actors: ["client"],
    clientConfirmed: true,
  }),
];

const display = buildLawyerBrief(session, 90);
assert.equal(display.timeline[0].actors[0], "landlord");
assert.equal(display.timeline[0].clientConfirmed, false);
assert.equal(display.timeline[1].clientConfirmed, true);
assert.equal(display.timeline[0].datePrecision, "month");

const solicitor = buildSolicitorBrief(session, 90, [], { consentToShare: true });
assert.equal(solicitor.handoff.consent_to_share, true);
assert.deepEqual(solicitor.timeline[0].actors, ["landlord"]);
assert.equal(solicitor.timeline[0].client_confirmed, false);
assert.equal(solicitor.timeline[0].source_span, "The landlord served a section 21 notice in March 2024.");
assert.deepEqual(solicitor.timeline[0].documents, ["section 21 notice"]);
assert.match(solicitor.client_narrative_raw || "", /posted a section 21 through the door/);
assert.match(display.clientNarrativeRaw, /posted a section 21 through the door/);

const a = hashShareToken("alpha");
const b = hashShareToken("alpha");
const c = hashShareToken("beta");
assert.equal(a, b);
assert.notEqual(a, c);

assert.equal(
  shareIsReadable({ expiresAt: new Date(Date.now() + 1000), revokedAt: null }),
  true,
);
assert.equal(
  shareIsReadable({ expiresAt: new Date(Date.now() - 1000), revokedAt: null }),
  false,
);
assert.equal(
  shareIsReadable({ expiresAt: new Date(Date.now() + 1000), revokedAt: new Date() }),
  false,
);

const sorted = sortTimelineEventsByDate([...session.events].reverse());
assert.equal(sorted[0].label, "Section 21 served");

assert.equal(
  tokenFromShareUrl("http://127.0.0.1:3000/share/notes/abcToken1234567890"),
  "abcToken1234567890",
);
assert.equal(
  tokenFromShareUrl("http://127.0.0.1:3000/api/coherence/share/abcToken1234567890"),
  "abcToken1234567890",
);
assert.equal(tokenFromShareUrl("http://127.0.0.1:3000/share/notes"), "");
assert.equal(
  shareNotesUrl("http://127.0.0.1:3000", "abcToken1234567890"),
  "http://127.0.0.1:3000/share/notes/abcToken1234567890",
);
assert.equal(
  originFromRequest(
    new Request("http://127.0.0.1:3000/api/coherence/share", {
      headers: { host: "127.0.0.1:3000" },
    }),
  ),
  "http://127.0.0.1:3000",
);

console.log("chronology-share-smoke: OK");
