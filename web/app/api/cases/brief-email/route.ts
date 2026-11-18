import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { accountsPrisma } from "@/lib/db/accounts";
import { ensureCaseSchema } from "@/lib/cases/schema";
import {
  briefFilename,
  buildLawyerBriefHtml,
  buildLawyerBriefPdf,
  buildLawyerBriefText,
  type LawyerBriefInput,
} from "@/lib/cases/lawyer-brief";
import { freeServicesForKind } from "@/lib/cases/free-services";
import type { ActionPlan, CaseRecord } from "@/lib/cases/types";
import type { DisputeKind } from "@/lib/cases/dispute-context";
import { sendEmail } from "@/lib/email/send";

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function mergePlan(plan: ActionPlan | null | undefined, kind: DisputeKind | null): ActionPlan | null {
  if (!plan) return null;
  if (plan.freeServices?.length) return plan;
  return { ...plan, freeServices: freeServicesForKind(kind) };
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required to email your brief" }, { status: 401 });
  }

  let body: {
    to?: string;
    caseId?: string;
    brief?: LawyerBriefInput;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const toRaw = (body.to || user.email || "").trim().toLowerCase();
  if (!toRaw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toRaw)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  let brief: LawyerBriefInput | null = body.brief || null;

  if (body.caseId && body.caseId !== "local-snapshot") {
    await ensureCaseSchema();
    const row = await accountsPrisma.consumerCase.findFirst({
      where: { id: body.caseId, userId: user.id },
    });
    if (row) {
      const kind = (row.matterType || null) as DisputeKind | null;
      const plan = mergePlan(row.actionPlan as ActionPlan | null, kind);
      brief = {
        title: row.title,
        summary: row.summary,
        matterType: row.matterType,
        fundingPreference: row.fundingPreference as CaseRecord["fundingPreference"],
        profileAnswers: row.profileAnswers as CaseRecord["profileAnswers"],
        actionPlan: plan,
        clientName: user.name || user.email,
        generatedAt: new Date().toISOString(),
      };
    }
  }

  if (!brief?.title || !brief.actionPlan) {
    return NextResponse.json(
      { error: "No results to email yet — finish the conversation first" },
      { status: 400 },
    );
  }

  brief = {
    ...brief,
    clientName: brief.clientName || user.name || user.email,
    generatedAt: brief.generatedAt || new Date().toISOString(),
  };

  const text = buildLawyerBriefText(brief);
  const html = buildLawyerBriefHtml(brief);
  const pdf = buildLawyerBriefPdf(brief);
  const filename = briefFilename(brief.title);

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (apiKey) {
    const from =
      process.env.EMAIL_FROM?.trim() || "Legal Shaman <noreply@legalshaman.com>";
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [toRaw],
          subject: `Legal Shaman matter brief — ${brief.title.slice(0, 80)}`,
          text,
          html,
          attachments: [
            {
              filename,
              content: bytesToBase64(pdf),
            },
          ],
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error("[brief-email] Resend error:", res.status, errText);
        return NextResponse.json({ error: "Couldn’t send email just now" }, { status: 502 });
      }
      const data = (await res.json()) as { id?: string };
      return NextResponse.json({ ok: true, id: data.id, to: toRaw });
    } catch (err) {
      console.error("[brief-email] send failed:", err);
      return NextResponse.json({ error: "Couldn’t send email just now" }, { status: 502 });
    }
  }

  // Dev / no Resend — still succeed via shared logger path (no attachment).
  const logged = await sendEmail({
    to: toRaw,
    subject: `Legal Shaman matter brief — ${brief.title.slice(0, 80)}`,
    text,
    html,
  });
  if (!logged.ok) {
    return NextResponse.json({ error: "Couldn’t send email just now" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, logged: true, to: toRaw, filename });
}
