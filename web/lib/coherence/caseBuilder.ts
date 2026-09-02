/**
 * Deterministic case-shaped Overview when the vault writer has a MatterFrame
 * and wiki hits. Used as the product fallback (and as the brief for LLM synthesis).
 */
import type { MatterFrame } from "@/lib/matter/types";
import { extractClientQuestions } from "./applyMatterFrame";

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
    questions.length ? `Client questions to cover:\n${questions.map((q) => `- ${q}`).join("\n")}` : "",
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
  const parts: string[] = [];
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
  const sourcesLine = hitTitles.slice(0, 6).join("; ") || "matched Legal Shaman wiki pages";
  const supplementalLine = (opts.supplemental || [])
    .slice(0, 8)
    .map((s) => (s.url ? `${s.title} (${s.url})` : s.title))
    .join("; ");

  const areaBits = [primary.replace(/_/g, " ")];
  if (secondary.includes("employment") && wages) areaBits.push("employment (pay, not dismissal or discrimination)");
  else if (secondary[0]) areaBits.push(secondary[0].replace(/_/g, " "));

  const liveNow: string[] = [];
  const later: string[] = [];
  if (stillOccupying) {
    liveNow.push("you are still in occupation — the missing door and isolation are the emergency, not a future move-out date");
    liveNow.push("treat removal of the door without a court-appointed bailiff as illegal eviction / Protection from Eviction; keep the crime number; ask police and the council to treat this as a lock-out while you remain");
    if (homeless) {
      later.push("homelessness / emergency accommodation is the fallback if it becomes unsafe to stay, not the first move while you are still inside");
    }
  } else {
    if (homeless || alreadyOut) {
      liveNow.push("somewhere safe to stay tonight and a homelessness application with the council");
    }
    if (lockout || alreadyOut) {
      liveNow.push("treat a lock-out or being forced out without a court-appointed bailiff as a housing emergency (illegal eviction / Protection from Eviction), keep the crime number, and do not abandon belongings if you can safely record what was left");
    }
  }
  if (wages) later.push("unpaid wages and holiday pay through ACAS — that is a separate employment claim, not a reason you had to leave");
  if (!liveNow.length) liveNow.push(`progress the ${primary.replace(/_/g, " ")} issue using the matched guidance`);

  const recs = [
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
  ];

  const answer = [
    "This client was recommended by LegalShaman.com (signposting only — not a paid referral, not legal advice).",
    "",
    "The matter",
    `The live problem is ${liveSituation(story, frame)}. ${
      alreadyOut
        ? "On these facts you have already been made to leave, so the case is homelessness and recovering the home/belongings, not a polite dispute about a future notice date."
        : "Stay with the frozen issue graph — do not switch the matter to a neighbouring wiki topic."
    }`,
    questions.length ? `Your questions: ${questions.join(" ")}` : "",
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
    takeaways: recs.slice(0, 5),
    recommendations: recs.slice(0, 4),
    options: [
      {
        title: "Self-help using official guidance tonight",
        description:
          stillOccupying
            ? "Stay in occupation if safe; police and crime number for the missing door; Shelter and your housing officer as soon as they open."
            : homeless || lockout
            ? "Council homelessness duty and Shelter first; keep evidence of the lock-out or forced exit."
            : "Work through the cited wiki pages and gather documents before you sign or leave.",
      },
      {
        title: "Independent review",
        description:
          primary === "housing"
            ? "Contact Shelter, the council homelessness team, and Citizens Advice. A lock-out is a housing emergency — not a deposit dispute."
            : "Ask Citizens Advice or a solicitor to review the documents and official guidance against your facts.",
      },
    ],
    missingFacts: [
      questions[0] || "Exact dates, notices, and the outcome you want.",
      "Whether a court order or bailiff was ever produced.",
      wages ? "Employment contract, last payslips, and the email tying pay to vacating." : "The documents the other side relies on.",
    ].slice(0, 5),
    followUpPrompts: [
      "Add the council email and crime reference wording.",
      "Say whether you still have access to the flat or only to belongings.",
      "Paste the wages / holiday-pay email if you want that strand sourced next.",
    ],
  };
}
