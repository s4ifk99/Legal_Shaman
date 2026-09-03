/**
 * Deterministic case-shaped Overview when the vault writer has a MatterFrame
 * and wiki hits. Used as the product fallback (and as the brief for LLM synthesis).
 */
import type { MatterFrame } from "@/lib/matter/types";
import { compressLiveGoal, extractClientQuestions } from "./clientQuestions";
import {
  graphIsWeakForHits,
  storyLooksEmployerSeizedKit,
  titleAdmissibleOnGeometry,
} from "@/lib/matter/graphAdmissibility";

export function formatCaseBrief(
  frame: MatterFrame,
  story: string,
  clientQuestion?: string,
): string {
  const primary = frame.primaryIssues.map((i) => `${i.slug.replace(/_/g, " ")} (${i.reason})`).join("; ");
  const secondary = frame.secondaryIssues
    .slice(0, 4)
    .map((i) => i.slug.replace(/_/g, " "))
    .join("; ");
  const exclusions = (frame.exclusions || []).slice(0, 8).join(", ");
  const questions = extractClientQuestions(`${clientQuestion || ""}\n${story}`);
  const live = liveSituation(story, frame);
  return [
    "==== CASE FILE (frozen — write the recommendation against this, not neighbouring wiki topics) ====",
    `Primary matter: ${primary || "uncertain"}.`,
    secondary ? `Also in play: ${secondary}.` : "",
    exclusions ? `Do not advise on excluded topics: ${exclusions}.` : "",
    `Live situation: ${live}.`,
    storyLooksEmployerSeizedKit(story)
      ? `Client goal: ${compressLiveGoal(`${clientQuestion || ""}\n${story}`)}.`
      : questions.length
        ? `Client questions to cover:\n${questions.map((q) => `- ${q}`).join("\n")}`
        : "",
    "Write a case: what the matter is, the area of law, what is live now vs later, and next steps in time order.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function liveSituation(story: string, frame: MatterFrame): string {
  const housing = frame.primaryIssues[0]?.slug === "housing";
  const lockout = /door.{0,24}removed|removed.{0,24}(?:the )?(?:front )?door|no front door|changed? (?:the )?locks?|forced .{0,40}(?:leave|vacate)|leave immediately|illegal evict/i.test(
    story,
  );
  const alreadyOut = /had no choice but to comply|leave everything else behind|son in law showed up/i.test(story);
  const homeless = /nowhere else|homeless|tonight|emergency (?:housing|alternative)|sofa to crash/i.test(story);
  const wages = /wages|holiday pay|ssp|statutory sick/i.test(story);
  const seizedKitSit = storyLooksEmployerSeizedKit(story);
  const parts: string[] = [];
  if (seizedKitSit) {
    parts.push("employer property seized by police from a staff member — not the asker's own arrest");
  } else {
    if (housing && lockout && !alreadyOut) {
      parts.push("still occupying after a lock-out / door removed without a court order");
    } else if (housing && lockout) {
      parts.push("possible illegal eviction / lock-out or being forced out without a court order");
    }
    if (homeless && alreadyOut) parts.push("immediate homelessness / nowhere safe tonight");
    else if (homeless && !alreadyOut && lockout) {
      parts.push("homelessness is a fallback if it becomes unsafe to stay");
    } else if (homeless) parts.push("immediate homelessness / nowhere safe tonight");
    if (wages) parts.push("wages or holiday pay withheld or tied to leaving");
  }
  if (!parts.length) {
    parts.push(
      frame.primaryIssues[0]
        ? `${frame.primaryIssues[0].slug.replace(/_/g, " ")} dispute`
        : "facts as given",
    );
  }
  return parts.join("; ");
}

export function buildCaseLedOverview(opts: {
  story: string;
  frame: MatterFrame;
  clientQuestion?: string;
  hitTitles: string[];
  supplemental?: { title: string; url?: string }[];
}): {
  answer: string;
  takeaways: string[];
  recommendations: string[];
  options: { title: string; description: string }[];
  missingFacts: string[];
  followUpPrompts: string[];
} {
  const { story, frame, clientQuestion, hitTitles } = opts;
  const questions = extractClientQuestions(`${clientQuestion || ""}\n${story}`);
  const primary = frame.primaryIssues[0]?.slug || "unknown";
  const secondary = frame.secondaryIssues.map((i) => i.slug);
  const lockout = /door.{0,24}removed|removed.{0,24}(?:the )?(?:front )?door|no front door|forced .{0,40}(?:leave|vacate)|leave immediately|illegal evict/i.test(
    story,
  );
  const homeless = /nowhere else|homeless|tonight|emergency (?:housing|alternative)|sofa to crash/i.test(story);
  const wages = /wages|holiday pay|ssp|statutory sick/i.test(story);
  const alreadyOut = /had no choice but to comply|leave everything else behind|son in law showed up/i.test(story);
  const stillOccupying = lockout && !alreadyOut;
  const housingMatter = primary === "housing";
  const seizedKit = storyLooksEmployerSeizedKit(story);
  const weakGraph = graphIsWeakForHits(hitTitles, frame, story);
  const admittedTitles = hitTitles.filter((t) =>
    titleAdmissibleOnGeometry(t, frame, story, { requireCoverage: true }),
  );
  const sourcesLine = admittedTitles.slice(0, 6).join("; ") || (weakGraph
    ? "no matching Legal Shaman wiki pages for this geometry"
    : "matched Legal Shaman wiki pages");
  const supplementalLine = (opts.supplemental || [])
    .slice(0, 8)
    .map((s) => (s.url ? `${s.title} (${s.url})` : s.title))
    .join("; ");

  const areaBits = [primary.replace(/_/g, " ")];
  if (secondary.includes("employment") && wages) areaBits.push("employment (pay, not dismissal or discrimination)");
  else if (secondary[0]) areaBits.push(secondary[0].replace(/_/g, " "));

  const liveNow: string[] = [];
  const later: string[] = [];
  if (housingMatter && stillOccupying) {
    liveNow.push("you are still in occupation — the missing door and isolation are the emergency, not a future move-out date");
    liveNow.push("treat removal of the door without a court-appointed bailiff as illegal eviction / Protection from Eviction; keep the crime number; ask police and the council to treat this as a lock-out while you remain");
    if (homeless) {
      later.push("homelessness / emergency accommodation is the fallback if it becomes unsafe to stay, not the first move while you are still inside");
    }
  } else if (housingMatter) {
    if (homeless || alreadyOut) {
      liveNow.push("somewhere safe to stay tonight and a homelessness application with the council");
    }
    if (lockout || alreadyOut) {
      liveNow.push("treat a lock-out or being forced out without a court-appointed bailiff as a housing emergency (illegal eviction / Protection from Eviction), keep the crime number, and do not abandon belongings if you can safely record what was left");
    }
  }
  if (wages && !seizedKit) later.push("unpaid wages and holiday pay through ACAS — that is a separate employment claim, not a reason you had to leave");
  if (seizedKit) {
    liveNow.push("write to the investigating force for the property reference and whether the laptop is retained as evidence");
    liveNow.push("whether police may examine employer files or Dropbox is a separate question from the staff member's interview");
    later.push("criminal defence advice is for the arrested person, not a substitute for recovering company kit");
  } else if (!liveNow.length) {
    liveNow.push(
      weakGraph
        ? "the library does not yet cover these live questions — do not complete the page with neighbouring wiki topics"
        : "use only cited pages that answer the live questions",
    );
  }

  const recs = housingMatter
    ? [
        stillOccupying
          ? "Stay in occupation if you can do so safely. Record the missing door, keep the crime number, and call police again — a landlord cannot lawfully evict you by taking the door off or by setting a leave-by date without a court order and bailiff."
          : homeless || alreadyOut
            ? "Call the council homelessness team again tonight and Shelter (including any out-of-hours line) — you are asking for emergency accommodation, not a tenancy-deposit review."
            : "Use the matched housing guidance and free help before paid advice.",
        stillOccupying
          ? "Call Shelter as soon as they open and your named housing officer — they are the people to press the council and landlord. Use the emergency housing number only if you are forced out or it becomes unsafe to stay."
          : lockout || alreadyOut
            ? "Keep the crime reference, council emails, and any proof the door was removed or you were told to leave without a court order and bailiff."
            : "Gather contracts, notices, dated messages, and the outcome you want.",
        wages
          ? "Treat last wages and holiday pay as an employment/ACAS issue in parallel — they should not be held hostage against leaving."
          : "Map each client question to a cited source before you act.",
        "This is signposting from Legal Shaman sources — get a Citizens Advice or solicitor check before filing if wording is uncertain.",
      ]
    : seizedKit
      ? [
          "Treat this as police seizure of employer property, not a housing or motoring matter. Ask the investigating force in writing for the property reference and whether the laptop is retained as evidence.",
          "A criminal defence solicitor is for the arrested person (police station / interview) — that is not the route for recovering your laptop.",
          "Write to the force, then get employer-side advice on recovering kit and whether work files may be examined.",
          "This is signposting from Legal Shaman sources — get a Citizens Advice or solicitor check before relying on it.",
        ]
      : [
          weakGraph
            ? "The library does not yet have enough matching pages for this geometry — do not switch to a neighbouring topic to complete the page."
            : "Use only the cited sources that sit on this frozen issue graph.",
          questions.length
            ? `Answer the live questions from those sources: ${questions.join(" ")}`
            : "Gather contracts, notices, dated messages, and the outcome you want.",
          "Ask Citizens Advice or a solicitor who actually does this kind of work before you file or write to the other side.",
          "This is signposting from Legal Shaman sources — not legal advice.",
        ];

  const answer = [
    "This client was recommended by LegalShaman.com (signposting only — not a paid referral, not legal advice).",
    "",
    "The matter",
    `The live problem is ${liveSituation(story, frame)}. ${
      alreadyOut && housingMatter
        ? "On these facts you have already been made to leave, so the case is homelessness and recovering the home/belongings, not a polite dispute about a future notice date."
        : weakGraph
          ? "The library is thin on this geometry — cite only admitted pages and do not complete the page with neighbour topics."
          : "Stay with the frozen issue graph — do not switch the matter to a neighbouring wiki topic."
    }`,
    seizedKit
      ? `Your goal: ${compressLiveGoal(`${clientQuestion || ""}\n${story}`)}.`
      : questions.length
        ? `Your questions: ${questions.join(" ")}`
        : "",
    "",
    "Area of law",
    `${areaBits.join("; ")}. ${
      frame.exclusions?.includes("discrimination_equality")
        ? "This is not a workplace equality claim unless you clearly allege a protected characteristic."
        : ""
    }`.trim(),
    "",
    "What is live now vs later",
    `Now: ${liveNow.join("; ")}.`,
    later.length ? `In parallel / next: ${later.join("; ")}.` : "",
    "",
    "Next steps",
    recs.map((r, i) => `${i + 1}. ${r}`).join("\n"),
    "",
    "Sources used from the library",
    sourcesLine,
    supplementalLine ? `\nSupplemental (Third Eye, labelled unverified)\n${supplementalLine}` : "",
    "",
    "This is Legal Shaman signposting from curated and clearly labelled supplemental sources — get a Citizens Advice or solicitor check before filing if wording is uncertain.",
  ].join("\n");

  return {
    answer,
    takeaways: recs.slice(0, 5).map(stripAuthorMetaTakeaway).filter(Boolean),
    recommendations: recs.slice(0, 4).map(stripAuthorMetaTakeaway).filter(Boolean),
    options: [
      {
        title: "Self-help using official guidance tonight",
        description:
          housingMatter && stillOccupying
            ? "Stay in occupation if safe; police and crime number for the missing door; Shelter and your housing officer as soon as they open."
            : housingMatter && (homeless || lockout)
            ? "Council homelessness duty and Shelter first; keep evidence of the lock-out or forced exit."
            : seizedKit
            ? "Write to the force about the property reference; get criminal-defence advice for the arrested person and employer-side advice on recovering company kit."
            : "Work through the cited wiki pages that actually match this matter and gather documents before you sign or leave.",
      },
      {
        title: "Independent review",
        description:
          housingMatter
            ? "Contact Shelter, the council homelessness team, and Citizens Advice. A lock-out is a housing emergency — not a deposit dispute."
            : seizedKit
            ? "Ask a criminal defence solicitor (for the arrested person) and an employment/commercial solicitor (for the employer’s property) — not a housing or motoring firm by default."
            : "Ask Citizens Advice or a solicitor to review the documents and official guidance against your facts.",
      },
    ],
    missingFacts: [
      questions[0] || "Exact dates, notices, and the outcome you want.",
      housingMatter
        ? "Whether a court order or bailiff was ever produced."
        : seizedKit
          ? "Whether anyone has been charged, and the police property reference for the laptop."
          : "The documents the other side or the police rely on.",
      wages ? "Employment contract, last payslips, and the email tying pay to vacating." : "The documents the other side relies on.",
    ].slice(0, 5),
    followUpPrompts: housingMatter
      ? [
          "Add the council email and crime reference wording.",
          "Say whether you still have access to the flat or only to belongings.",
          "Paste the wages / holiday-pay email if you want that strand sourced next.",
        ]
      : seizedKit
        ? [
            "Add the police force and any property / crime reference.",
            "Say whether the arrested person has been charged or released.",
            "Say whether the laptop is company-owned and whether Dropbox is work or personal.",
          ]
        : [
            "Paste the documents or messages that set out what you want next.",
            "Name the other party and what they have already done.",
            "Say which of your questions still needs a source.",
          ],
  };
}

/** Author-only notes must never appear as user-facing takeaways. */
export const AUTHOR_META_TAKEAWAY =
  /do not paste|cover the client's live questions|Your live questions:/i;

export function stripAuthorMetaTakeaway(text: string): string {
  return String(text || "")
    .replace(/\s*[—–-]\s*do not paste[\s\S]*$/i, "")
    .replace(/\s*do not paste the client's question list into the takeaways\.?/gi, "")
    .replace(/\s*cover the client's live questions[:.]?/gi, "")
    .replace(/\s*Your live questions:\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Honest thin Overview when synthesis fails: library-thin note + admitted
 * Third Eye / official URLs, without instructional author notes in bullets.
 */
export function buildThinHonestOverview(opts: {
  story: string;
  frame: MatterFrame;
  clientQuestion?: string;
  supplemental?: { title: string; url?: string }[];
}): ReturnType<typeof buildCaseLedOverview> {
  const urls = (opts.supplemental || []).filter((s) => s.title);
  const urlLines = urls
    .slice(0, 8)
    .map((s) => (s.url ? `- ${s.title} (${s.url})` : `- ${s.title}`))
    .join("\n");
  const seizedKit = storyLooksEmployerSeizedKit(opts.story);
  const takeaways = (
    seizedKit
      ? [
          "The library does not yet have enough matching pages for this geometry — do not complete the page with neighbouring wiki topics.",
          "Write to the investigating force for the property reference and whether the laptop is retained as evidence.",
          "Ask whether police may examine employer files on the seized device; that is separate from the arrested person's interview.",
          "This is signposting from Legal Shaman sources — get a Citizens Advice or solicitor check before relying on it.",
        ]
      : [
          "The library does not yet have enough matching pages for this geometry — do not complete the page with neighbouring wiki topics.",
          "Use only the admitted official or Third Eye URLs below; do not invent statutes or neighbour topics.",
          "Gather the documents and the outcome you want, then get a Citizens Advice or solicitor check.",
          "This is signposting from Legal Shaman sources — not legal advice.",
        ]
  ).map(stripAuthorMetaTakeaway);

  const answer = [
    "This client was recommended by LegalShaman.com (signposting only — not a paid referral, not legal advice).",
    "",
    "The library is thin on this geometry — it does not yet have enough matching pages for these live questions. Do not switch to a neighbouring topic to complete the page.",
    "",
    urlLines
      ? `Admitted supplemental sources (Third Eye / official, labelled unverified unless official):\n${urlLines}`
      : "No matching Legal Shaman wiki pages and no admitted supplemental URLs yet.",
    seizedKit
      ? "Write to the investigating force about the property reference. Recovering employer kit is a separate route from criminal defence for the arrested person."
      : "",
    "",
    "This is Legal Shaman signposting from curated and clearly labelled supplemental sources — get a Citizens Advice or solicitor check before filing if wording is uncertain.",
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  return {
    answer,
    takeaways,
    recommendations: takeaways.slice(0, 4),
    options: [
      {
        title: "Use admitted sources only",
        description:
          "Work from the labelled Third Eye and official URLs. Do not fill gaps with housing, garden, motoring, or consumer wiki.",
      },
      {
        title: "Independent review",
        description: seizedKit
          ? "Ask a criminal defence solicitor for the arrested person and employer-side advice on recovering company kit."
          : "Ask Citizens Advice or a solicitor who actually does this kind of work.",
      },
    ],
    missingFacts: [
      extractClientQuestions(`${opts.clientQuestion || ""}\n${opts.story}`)[0] ||
        "Exact dates, notices, and the outcome you want.",
      seizedKit
        ? "Whether anyone has been charged, and the police property reference for the laptop."
        : "The documents the other side or the police rely on.",
    ],
    followUpPrompts: seizedKit
      ? [
          "Add the police force and any property / crime reference.",
          "Say whether the arrested person has been charged or released.",
          "Say whether the laptop is company-owned and whether Dropbox is work or personal.",
        ]
      : [
          "Paste the documents or messages that set out what you want next.",
          "Name the other party and what they have already done.",
          "Say which of your questions still needs a source.",
        ],
  };
}
