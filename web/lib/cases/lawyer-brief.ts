import type { ActionPlan, CaseProfileAnswers, FundingPreference } from "@/lib/cases/types";
import type { DisputeKind } from "@/lib/cases/dispute-context";
import { formatOptionsForPlan } from "@/lib/cases/build-action-plan";

export type LawyerBriefInput = {
  title: string;
  summary?: string | null;
  matterType?: string | null;
  fundingPreference?: FundingPreference | null;
  profileAnswers?: CaseProfileAnswers | null;
  actionPlan?: ActionPlan | null;
  clientName?: string | null;
  generatedAt?: string;
};

function fundingLabel(pref: FundingPreference | null | undefined): string {
  switch (pref) {
    case "legal_aid":
      return "Legal aid first";
    case "pro_bono":
      return "Free advice first";
    case "insurance":
      return "Insurance / union cover";
    case "fixed_fee":
      return "Open to fixed-fee help";
    case "private":
      return "Open to private help";
    default:
      return "Still exploring financing";
  }
}

function kindLabel(kind: string | null | undefined): string {
  if (!kind) return "General";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Plain-text lawyer briefing — for email body and PDF lines. */
export function buildLawyerBriefText(input: LawyerBriefInput): string {
  const when = input.generatedAt || new Date().toISOString();
  const answers = input.profileAnswers || {};
  const plan = input.actionPlan;
  const lines: string[] = [
    "LEGAL SHAMAN — CLIENT MATTER BRIEF",
    "=================================",
    "",
    "This summary was prepared by the client with Legal Shaman’s guided intake.",
    "It is not legal advice and is not a formal instruction. Please verify everything with the client.",
    "",
    `Generated: ${when}`,
    input.clientName ? `Client: ${input.clientName}` : null,
    `Matter title: ${input.title || "Your situation"}`,
    `Matter type: ${kindLabel(input.matterType)}`,
    `Funding path (client preference): ${fundingLabel(input.fundingPreference)}`,
    "",
    "WHAT HAPPENED",
    "-------------",
    (answers.disputeStory || input.summary || "Not recorded.").trim(),
    "",
  ].filter((x): x is string => x !== null);

  const disputeAnswers = answers.disputeAnswers || {};
  const daKeys = Object.keys(disputeAnswers);
  if (daKeys.length) {
    lines.push("KEY DETAILS", "-----------");
    for (const k of daKeys) {
      lines.push(`• ${k}: ${disputeAnswers[k]}`);
    }
    lines.push("");
  }

  if (answers.wantSpeakToSomeone) {
    lines.push(`Speak to someone: ${answers.wantSpeakToSomeone}`);
  }
  if (answers.solicitorMatchMode) {
    const place = answers.solicitorLocation ? ` near ${answers.solicitorLocation}` : "";
    lines.push(`Solicitor match preference: ${answers.solicitorMatchMode}${place}`);
  }
  if (answers.freeServicesTried) {
    lines.push(`Free services already tried: ${answers.freeServicesTried}`);
  }
  if (answers.legalAidSummary || answers.legalAidLikelihood) {
    lines.push(
      `Legal aid screen: ${answers.legalAidLikelihood || "unsure"}${
        answers.legalAidSummary ? ` — ${answers.legalAidSummary}` : ""
      }`,
    );
  }
  if (answers.freeAdviceFirst) lines.push(`Prefer free advice first: ${answers.freeAdviceFirst}`);
  if (answers.openToPaying) lines.push(`Open to paying: ${answers.openToPaying}`);
  if (answers.insuranceCover) lines.push(`Insurance / union / cover: ${answers.insuranceCover}`);
  lines.push("");

  if (plan?.steps?.length) {
    lines.push("PLAN OF ACTION (PLAIN ENGLISH)", "-------------------------------");
    plan.steps
      .filter((s) => s.id !== "free-services")
      .forEach((step, i) => {
        lines.push(`${i + 1}. ${step.label}`);
        for (const line of step.detail.split("\n")) {
          lines.push(line.trim() ? `   ${line}` : "");
        }
        if (step.spendAdvice) lines.push(`   Spend note: ${step.spendAdvice}`);
        lines.push("");
      });
    lines.push("");
  }

  if (plan?.universalCreditMap) {
    const uc = plan.universalCreditMap;
    lines.push("UNIVERSAL CREDIT — RIGHTS & OPTIONS", "------------------------------------");
    lines.push(uc.headline);
    lines.push(`Stage: ${uc.stage}`);
    if (uc.lawTopics?.length) {
      lines.push("Rights (plain English):");
      for (const t of uc.lawTopics) {
        lines.push(`• ${t.title}: ${t.rightInPlainEnglish} ${t.whatItMeansForYou}`);
        if (t.sourceUrl) lines.push(`  Source: ${t.sourceUrl}`);
      }
    }
    lines.push(
      `Entitlement triage: ${uc.entitlementLikelihood} — ${uc.entitlementSummary}`,
    );
    lines.push(
      `Challenge / appeal triage: ${uc.appealLikelihood} — ${uc.appealSummary}`,
    );
    lines.push("Process doors:");
    for (const d of uc.processDoors) {
      lines.push(
        `• ${d.title} — ${d.summary}${d.deadlineHint ? ` (${d.deadlineHint})` : ""}`,
      );
    }
    lines.push("Evidence:");
    for (const tip of uc.evidenceTips) lines.push(`• ${tip}`);
    lines.push(uc.legalAidNote);
    lines.push(uc.financingNote);
    lines.push(uc.honestNote);
    if (uc.eligibilityUrl) lines.push(`Eligibility: ${uc.eligibilityUrl}`);
    lines.push(`Challenge: ${uc.checkUrl}`);
    lines.push(`Appeal: ${uc.appealUrl}`);
    lines.push("");
  }

  if (plan?.legalAidMap) {
    lines.push("LEGAL AID MAP", "-------------");
    lines.push(plan.legalAidMap.headline);
    lines.push(
      `Scope band: ${plan.legalAidMap.scopeBand}` +
        (plan.legalAidMap.likelihood ? ` · Screen: ${plan.legalAidMap.likelihood}` : ""),
    );
    for (const d of plan.legalAidMap.doors) {
      lines.push(`• ${d.title} [${d.band}] — ${d.summary}`);
    }
    lines.push(plan.legalAidMap.outOfScopeNote);
    lines.push("Means (triage):");
    for (const r of plan.legalAidMap.meansRules) {
      lines.push(`• ${r.title}: ${r.summary}`);
    }
    lines.push(plan.legalAidMap.meritsNote);
    lines.push(plan.legalAidMap.honestNote);
    lines.push(`Check: ${plan.legalAidMap.checkUrl}`);
    lines.push(`Find provider: ${plan.legalAidMap.findProviderUrl}`);
    lines.push("");
  }

  if (plan?.financingMap) {
    lines.push("FINANCING MAP (CLAIM TO COSTS)", "--------------------------------");
    lines.push(
      `Complexity: ${plan.financingMap.complexity} — ${plan.financingMap.complexityReason}`,
    );
    for (const opt of plan.financingMap.options) {
      lines.push(
        `• ${opt.title}${opt.likelihood ? ` [${opt.likelihood}]` : ""} — ${opt.blurb}`,
      );
      if (opt.url) lines.push(`  ${opt.url}`);
    }
    if (plan.financingMap.contacts.length) {
      lines.push("Financing contacts:");
      for (const c of plan.financingMap.contacts) {
        lines.push(`• ${c.name} (${c.role}) — ${c.blurb}`);
        if (c.url) lines.push(`  ${c.url}`);
      }
    }
    lines.push(plan.financingMap.honestNote);
    lines.push("");
  }

  if (plan?.matchedSolicitors?.length) {
    lines.push("SRA REGISTER MATCHES", "--------------------");
    if (plan.solicitorMatchMode) {
      lines.push(
        `Preference: ${plan.solicitorMatchMode}${
          plan.solicitorLocation ? ` · ${plan.solicitorLocation}` : ""
        }`,
      );
    }
    for (const s of plan.matchedSolicitors) {
      lines.push(`• ${s.name}`);
      lines.push(`  ${s.blurb}`);
      if (s.phone) lines.push(`  Tel: ${s.phone}`);
      if (s.sraId) lines.push(`  SRA ID: ${s.sraId}`);
      if (s.url) lines.push(`  ${s.url}`);
    }
    lines.push("");
  }

  if (plan?.freeServices?.length) {
    lines.push("FREE SERVICES THAT MAY APPLY", "----------------------------");
    if (plan.freeAdviceGuide) {
      lines.push(
        `Guided by Pro Bono Week free-advice guides (${plan.freeAdviceGuide.nationLabel}).`,
      );
      lines.push(`Guide PDF: ${plan.freeAdviceGuide.pdfUrl}`);
      lines.push(`Hub: ${plan.freeAdviceGuide.hubUrl}`);
      for (const n of plan.freeAdviceGuide.notes.slice(0, 2)) lines.push(n);
    }
    for (const s of plan.freeServices) {
      lines.push(`• ${s.name}`);
      lines.push(`  ${s.blurb}`);
      if (s.phone) lines.push(`  Tel: ${s.phone}`);
      if (s.url) lines.push(`  ${s.url}`);
    }
    lines.push("");
  }

  if (answers.optionsExplanation) {
    lines.push("OPTIONS EXPLAINED TO THE CLIENT", "-------------------------------");
    lines.push(formatOptionsForPlan(answers.optionsExplanation));
    lines.push("");
  }

  lines.push(
    "—",
    "Legal Shaman · legalshaman.com",
    "Directory-first signposting. Not a solicitor. Not a substitute for advice.",
  );

  return lines.join("\n");
}

export function buildLawyerBriefHtml(input: LawyerBriefInput): string {
  const text = buildLawyerBriefText(input);
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8"/>
<title>Legal Shaman — Matter brief</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; color: #1a2e1f; background: #f7f4ef; margin: 0; padding: 32px; }
  .sheet { max-width: 720px; margin: 0 auto; background: #fff; border: 1px solid #c4b59a; padding: 36px 40px; }
  .brand { font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; color: #3d6b4f; font-weight: 700; }
  h1 { font-size: 26px; margin: 8px 0 4px; color: #142018; }
  .sub { color: #5a6b5e; font-size: 13px; margin-bottom: 24px; }
  pre { white-space: pre-wrap; font-family: Georgia, serif; font-size: 14px; line-height: 1.55; margin: 0; }
  .foot { margin-top: 28px; padding-top: 14px; border-top: 1px solid #e0d6c6; font-size: 11px; color: #6a7a6e; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="brand">Legal Shaman</div>
    <h1>Client matter brief</h1>
    <p class="sub">Prepared to help explain this matter to a lawyer. Not legal advice.</p>
    <pre>${escaped}</pre>
    <p class="foot">legalshaman.com · Not a solicitor · Verify all facts with the client</p>
  </div>
</body>
</html>`;
}

/** Minimal PDF 1.4 text document with Legal Shaman branding. */
export function buildLawyerBriefPdf(input: LawyerBriefInput): Uint8Array {
  const rawLines = buildLawyerBriefText(input).split("\n");
  const maxWidth = 90;
  const wrapped: string[] = [];
  for (const line of rawLines) {
    if (line.length <= maxWidth) {
      wrapped.push(line);
      continue;
    }
    let rest = line;
    while (rest.length > maxWidth) {
      let breakAt = rest.lastIndexOf(" ", maxWidth);
      if (breakAt < 40) breakAt = maxWidth;
      wrapped.push(rest.slice(0, breakAt));
      rest = rest.slice(breakAt).trimStart();
    }
    if (rest) wrapped.push(rest);
  }

  const escapePdf = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  const contentParts: string[] = [
    "BT",
    "/F1 11 Tf",
    "50 780 Td",
    "14 TL",
  ];
  let yLines = 0;
  const maxLinesPerPage = 52;
  for (const line of wrapped) {
    if (yLines > 0 && yLines % maxLinesPerPage === 0) {
      contentParts.push("ET");
      // Simple single-page soft limit: stop rather than complex multi-page for v1
      contentParts.push("BT", "/F1 9 Tf", "50 40 Td", `(…continued in email body if truncated) Tj`);
      contentParts.push("ET");
      break;
    }
    contentParts.push(`(${escapePdf(line)}) Tj`, "T*");
    yLines += 1;
  }
  if (!contentParts.includes("ET")) contentParts.push("ET");

  const encoder = new TextEncoder();
  const stream = contentParts.join("\n");
  const streamBytes = encoder.encode(stream).length;
  const objects: string[] = [];
  objects.push("1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj");
  objects.push("2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj");
  objects.push(
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj",
  );
  objects.push(`4 0 obj<< /Length ${streamBytes} >>stream\n${stream}\nendstream endobj`);
  objects.push("5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(encoder.encode(pdf).length);
    pdf += obj + "\n";
  }
  const xrefPos = encoder.encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  return encoder.encode(pdf);
}

export function briefFilename(title: string): string {
  const slug = (title || "matter")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `legal-shaman-brief-${slug || "matter"}.pdf`;
}

export function disputeKindFromBrief(input: LawyerBriefInput): DisputeKind | null {
  const k = input.matterType || input.profileAnswers?.disputeKind || null;
  return (k as DisputeKind | null) || null;
}
