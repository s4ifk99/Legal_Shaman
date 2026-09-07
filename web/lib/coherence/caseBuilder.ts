/**
 * Deterministic case-shaped Overview when the vault writer has a MatterFrame
 * and wiki hits. Used as the product fallback (and as the brief for LLM synthesis).
 */
import type { MatterFrame } from "@/lib/matter/types";
import { extractClientQuestions, liveAskFromStory } from "./clientQuestions";
import {
  graphIsWeakForHits,
  storyLooksEmployerSeizedKit,
  titleAdmissibleOnGeometry,
} from "@/lib/matter/graphAdmissibility";
import { shamanFormatAnswer } from "./shamanRecFormat";

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
  const ask = liveAskFromStory(story, clientQuestion);
  return [
    "==== CASE FILE (frozen — write the recommendation against this, not neighbouring wiki topics) ====",
    `Primary matter: ${primary || "uncertain"}.`,
    secondary ? `Also in play: ${secondary}.` : "",
    exclusions ? `Do not advise on excluded topics: ${exclusions}.` : "",
    `Live situation: ${live}.`,
    ask.solicitorConduct
      ? "Operative dispute: solicitor conduct / Legal Ombudsman / SRA / fees — not the underlying employment claim."
      : "",
    ask.policeVehicleClaim
      ? "Operative dispute: claim against the police for damage to a parked vehicle — garage is location/contact only, not a workmanship claim."
      : "",
    questions.length
      ? `Client questions to cover (answer each in order; never paste this list into takeaways):\n${questions.map((q) => `- ${q}`).join("\n")}`
      : "",
    "Write sections exactly titled: What the sources say; Practical route; Limits / missing facts. Put next steps as bullet lines under Practical route. Do not use markdown # headings or raw [text](url) links — plain URLs only if needed.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function liveSituation(story: string, frame: MatterFrame): string {
  const ask = liveAskFromStory(story);
  if (ask.solicitorConduct) {
    const bits: string[] = ["complaint about former solicitors"];
    if (ask.themes.includes("solicitor_ombudsman")) bits.push("Legal Ombudsman / fee refunds");
    if (ask.themes.includes("sra_conduct")) bits.push("SRA / supervision or conduct");
    if (ask.themes.includes("solicitor_costs")) bits.push("success fee / costs dispute");
    return bits.join("; ");
  }
  if (ask.policeVehicleClaim || ask.themes.includes("police_vehicle_claim")) {
    return "claim against police for damage to a parked / stationary vehicle (garage is location only)";
  }
  const housing = frame.primaryIssues[0]?.slug === "housing";
  const lockout = /door.{0,24}removed|removed.{0,24}(?:the )?(?:front )?door|no front door|changed? (?:the )?locks?|forced .{0,40}(?:leave|vacate)|leave immediately|illegal evict/i.test(
    story,
  );
  const alreadyOut = /had no choice but to comply|leave everything else behind|son in law showed up/i.test(story);
  const homeless = /nowhere else|homeless|tonight|emergency (?:housing|alternative)|sofa to crash/i.test(story);
  const wages =
    ask.themes.includes("employment_wages") ||
    (/wages|holiday pay|ssp|statutory sick/i.test(story) &&
      /withheld|until .{0,20}leave|upon vacating|vacating/i.test(story));
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
  const ask = liveAskFromStory(story, clientQuestion);
  const questions = ask.questions.length
    ? ask.questions
    : extractClientQuestions(`${clientQuestion || ""}\n${story}`);
  const primary = frame.primaryIssues[0]?.slug || "unknown";
  const secondary = frame.secondaryIssues.map((i) => i.slug);
  const lockout = /door.{0,24}removed|removed.{0,24}(?:the )?(?:front )?door|no front door|forced .{0,40}(?:leave|vacate)|leave immediately|illegal evict/i.test(
    story,
  );
  const homeless = /nowhere else|homeless|tonight|emergency (?:housing|alternative)|sofa to crash/i.test(story);
  const wagesLive = ask.themes.includes("employment_wages");
  const wagesNarrative =
    !ask.solicitorConduct &&
    /wages|holiday pay|ssp|statutory sick/i.test(story) &&
    /withheld|until .{0,20}leave|upon vacating|vacating/i.test(story);
  const wages = wagesLive || wagesNarrative;
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

  if (ask.solicitorConduct) {
    const leoTitles = admittedTitles.filter((t) =>
      /legal ombudsman|complain about a legal|solicitor|sra|costs|success fee|supervision/i.test(t),
    );
    const sourcesSay = leoTitles.length
      ? `Matched guidance on complaining about a solicitor points at the Legal Ombudsman for service and billing (including possible fee reductions or refunds) and the SRA for conduct, integrity, and supervision failures. Your live questions are about ${questions.slice(0, 3).join(" ")} — not workplace grievances or pay disputes.`
      : weakGraph
        ? `The library is thin on solicitor-conduct pages for this geometry. Your live questions concern the Legal Ombudsman, SRA, fees, and supervision — not employment rights or workplace pay.`
        : `On these facts the live dispute is your complaint about the firm (Legal Ombudsman / SRA / success fees / trainee supervision). Use only sources about complaining about a legal adviser — not “problems at work” or workplace pay pages.`;

    const practical = [
      "Finish the firm’s complaints procedure in writing and keep the stage-two response and dates.",
      "Take the service / fees / supervision complaint to the Legal Ombudsman if the firm’s response is inadequate or late — ask what redress (including fee reduction or refund) is realistic on your facts.",
      "Report suspected conduct, integrity, fake-review, or unsupervised-trainee issues to the SRA; LeO and SRA can run in parallel for different limbs.",
      "Keep the without-prejudice valuation, settlement figures, invoice, SAR (no supervision records), and review screenshots as a dated evidence pack.",
    ];

    const related =
      leoTitles[0] ||
      admittedTitles.find((t) => /ombudsman|sra|complain/i.test(t)) ||
      "Complain about a legal adviser";

    const answer = shamanFormatAnswer({
      sourcesSay,
      practical,
      relatedTitle: related,
      relatedBody: `Related guidance: ${related}. Cross-check GOV.UK “Complain about a legal adviser”, Legal Ombudsman, and SRA “Problems with law firms” against your stage-two pack.${
        supplementalLine ? ` Supplemental (unverified): ${supplementalLine}.` : ""
      }`,
      limits: `This is general signposting from LegalShaman.com — not legal advice and not a prediction of a LeO or SRA outcome. Sources used: ${sourcesLine}. Check Citizens Advice or a costs/professional-negligence solicitor before relying on it.`,
    });

    return {
      answer,
      takeaways: practical.slice(0, 5),
      recommendations: practical.slice(0, 4),
      options: [
        {
          title: "Legal Ombudsman (service / fees)",
          description:
            "Escalate the incomplete stage-two response and fee / success-fee limbs for possible redress including fee reduction or compensation.",
        },
        {
          title: "SRA (conduct / supervision)",
          description:
            "Report trainee supervision gaps, integrity concerns, and alleged fake client reviews — parallel to LeO, not instead of it.",
        },
      ],
      missingFacts: [
        questions[0] || "What redress you want from LeO (fee refund vs distress compensation).",
        "Whether the tribunal claim was formally withdrawn as part of settlement.",
        "The firm’s written complaints procedure and stage-two letter date.",
      ],
      followUpPrompts: [
        "Paste the stage-two complaints response and the invoice breakdown.",
        "Say whether the employment tribunal claim was withdrawn in writing.",
        "Add the SAR extract showing no supervision records.",
      ],
    };
  }

  if (ask.policeVehicleClaim || ask.themes.includes("police_vehicle_claim")) {
    const claimTitles = admittedTitles.filter((t) =>
      /police|claim|insurance|collision|IOPC|complain about (?:the )?police|accident/i.test(t),
    );
    const sourcesSay = claimTitles.length
      ? `Matched guidance points at claiming for vehicle damage caused by another party (here: a police vehicle in pursuit) and using the force’s claims process. Your live questions are about ${questions.slice(0, 3).join(" ")} — not garage workmanship, quotes, or repair bills.`
      : weakGraph
        ? `The library is thin on police-vehicle damage claim pages. Your live questions concern claiming against the police after a pursuit hit a parked car — not a garage repair dispute.`
        : `On these facts the live dispute is a claim against the police for damaging a stationary parked car. Use only sources about police claims / vehicle damage / insurance — not “problem with a car repair” quote pages.`;

    const practical = [
      "Contact the police using the details they left and ask for the claims / insurance handler and any incident or crime reference.",
      "Photograph the damage, keep the garage’s account of what happened, and get a written repair estimate.",
      "Check the owner’s motor insurance and whether to claim through the insurer or direct against the force — Citizens Advice can help map the route.",
      "If the force’s response is inadequate, ask about their formal complaints route (Professional Standards / IOPC) as well as a civil claim.",
    ];

    const related =
      claimTitles[0] ||
      admittedTitles.find((t) => /police|insurance|claim|accident/i.test(t)) ||
      "Claim against the police for vehicle damage";

    const answer = shamanFormatAnswer({
      sourcesSay,
      practical,
      relatedTitle: related,
      relatedBody: `Related guidance: ${related}. Cross-check Citizens Advice vehicle-damage / insurance pages and the force’s published claims information.${
        supplementalLine ? ` Supplemental (unverified): ${supplementalLine}.` : ""
      }`,
      limits: `This is general signposting from LegalShaman.com — not legal advice and not a prediction of liability. Sources used: ${sourcesLine}. Missing facts often include the incident date, force name, reference number, and insurance policy details.`,
    });

    return {
      answer,
      takeaways: practical.slice(0, 5),
      recommendations: practical.slice(0, 4),
      options: [
        {
          title: "Claim via the police force",
          description:
            "Use the contact details left at the scene, ask for the claims handler, and lodge a property-damage claim against the force.",
        },
        {
          title: "Insurance and free advice",
          description:
            "Speak to the motor insurer and Citizens Advice about whether to claim through insurance or direct against the police.",
        },
      ],
      missingFacts: [
        questions[0] || "The police force name and incident / crime reference.",
        "Whether the owner has comprehensive motor insurance and an excess.",
        "Written repair estimate and photos of the damage.",
      ],
      followUpPrompts: [
        "Paste the police contact details and any reference number.",
        "Say whether the car is comprehensively insured.",
        "Add the garage’s written note of what they saw.",
      ],
    };
  }

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

  const answer = shamanFormatAnswer({
    sourcesSay: [
      weakGraph
        ? "The library is thin on this geometry — it does not yet have enough matching pages for these live questions."
        : "",
      `The live problem is ${liveSituation(story, frame)}.`,
      questions.length ? `Your questions: ${questions.join(" ")}` : "",
      `Area of law: ${areaBits.join("; ")}.`,
      `Now: ${liveNow.join("; ")}.`,
      later.length ? `In parallel / next: ${later.join("; ")}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    practical: recs,
    relatedTitle: admittedTitles[0],
    relatedBody: admittedTitles[0]
      ? `Matched page “${admittedTitles[0]}”. Sources used: ${sourcesLine}.${
          supplementalLine ? ` Supplemental (unverified): ${supplementalLine}.` : ""
        }`
      : `Sources used: ${sourcesLine}.${supplementalLine ? ` Supplemental (unverified): ${supplementalLine}.` : ""}`,
    limits:
      "This is LegalShaman.com signposting from curated and clearly labelled supplemental sources — get a Citizens Advice or solicitor check before filing if wording is uncertain.",
  });

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

  const practical = takeaways.slice(0, 4);
  const answer = shamanFormatAnswer({
    sourcesSay:
      "The library is thin on this geometry — it does not yet have enough matching pages for these live questions. Do not switch to a neighbouring topic to complete the page.",
    practical,
    relatedTitle: urls[0]?.title,
    relatedBody: urlLines
      ? `Admitted supplemental sources (Third Eye / official, labelled unverified unless official):
${urlLines}`
      : "No matching Legal Shaman wiki pages and no admitted supplemental URLs yet.",
    limits:
      "This is LegalShaman.com signposting from curated and clearly labelled supplemental sources — get a Citizens Advice or solicitor check before filing if wording is uncertain.",
  });

  return {
    answer,
    takeaways,
    recommendations: practical,
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
