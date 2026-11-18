"use client";

import { useState } from "react";
import type {
  ActionPlan,
  ActionPlanFinancingMap,
  ActionPlanFreeService,
  ActionPlanLegalAidMap,
  ActionPlanSolicitor,
  ActionPlanUcMap,
} from "@/lib/cases/types";
import type { DisputeKind } from "@/lib/cases/dispute-context";
import {
  briefFilename,
  buildLawyerBriefPdf,
  type LawyerBriefInput,
} from "@/lib/cases/lawyer-brief";
import {
  buildCostRequestEmail,
  COST_REQUEST_BCC,
  serviceLabelForKind,
  sraRequiresPublishedPrices,
} from "@/lib/cases/solicitor-costs";
import { resolveApiUrl } from "@/lib/site/api-url";

function ucLikelihoodLabel(v: ActionPlanUcMap["entitlementLikelihood"]) {
  switch (v) {
    case "likely":
      return "Likely";
    case "possible":
      return "Possible";
    case "unlikely":
      return "Unlikely";
    default:
      return "Unsure";
  }
}

function UcMapSection({ map }: { map: ActionPlanUcMap }) {
  return (
    <section className="mt-8 border-t border-gold/20 pt-6">
      <h3 className="font-serif text-xl font-semibold text-foreground">
        Universal Credit — your rights & options
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{map.headline}</p>
      <p className="mt-2 text-xs font-medium text-primary">
        Stage focus: {map.stage.replaceAll("_", " ")}
      </p>

      {map.lawTopics?.length ? (
        <>
          <h4 className="mt-6 font-serif text-lg font-semibold text-foreground">
            What the law says (plain English)
          </h4>
          <ul className="mt-3 space-y-3">
            {map.lawTopics.map((t) => (
              <li
                key={t.id}
                className="rounded-2xl border border-gold/25 bg-background/80 px-4 py-3"
              >
                <p className="font-medium text-foreground">{t.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {t.rightInPlainEnglish}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-foreground/85">
                  {t.whatItMeansForYou}
                </p>
                {t.sourceUrl ? (
                  <a
                    href={t.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-xs text-primary underline underline-offset-2"
                  >
                    {t.sourceLabel || "Source"}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h4 className="mt-6 font-serif text-lg font-semibold text-foreground">
        Entitlement & challenge triage
      </h4>
      <div className="mt-3 space-y-3">
        <div className="rounded-2xl border border-border/50 bg-background/70 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">
            Entitlement — {ucLikelihoodLabel(map.entitlementLikelihood)}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {map.entitlementSummary}
          </p>
        </div>
        <div className="rounded-2xl border border-border/50 bg-background/70 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">
            Challenge / appeal — {ucLikelihoodLabel(map.appealLikelihood)}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {map.appealSummary}
          </p>
        </div>
      </div>

      <h4 className="mt-6 font-serif text-lg font-semibold text-foreground">Process doors</h4>
      <ul className="mt-3 space-y-3">
        {map.processDoors.map((d) => (
          <li
            key={d.id}
            className="rounded-2xl border border-gold/25 bg-background/80 px-4 py-3"
          >
            <p className="font-medium text-foreground">{d.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{d.summary}</p>
            {d.deadlineHint ? (
              <p className="mt-1 text-xs font-medium text-primary">Deadline: {d.deadlineHint}</p>
            ) : null}
            {d.url ? (
              <a
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs text-primary underline underline-offset-2"
              >
                Source
              </a>
            ) : null}
          </li>
        ))}
      </ul>

      <h4 className="mt-6 font-serif text-lg font-semibold text-foreground">Evidence to gather</h4>
      <ul className="mt-3 space-y-2">
        {map.evidenceTips.map((tip, i) => (
          <li key={i} className="flex gap-2.5 text-sm text-foreground/85">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" aria-hidden />
            <span>{tip}</span>
          </li>
        ))}
      </ul>

      <h4 className="mt-6 font-serif text-lg font-semibold text-foreground">Who can help</h4>
      <ul className="mt-3 space-y-3">
        {map.helpDoors.map((h) => (
          <li
            key={h.id}
            className="rounded-2xl border border-border/50 bg-background/70 px-4 py-3"
          >
            <p className="font-medium text-foreground">{h.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">{h.blurb}</p>
            {h.url ? (
              <a
                href={h.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs text-primary underline underline-offset-2"
              >
                Open site
              </a>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{map.legalAidNote}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{map.financingNote}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{map.honestNote}</p>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-primary">
        {map.eligibilityUrl ? (
          <a
            href={map.eligibilityUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            UC eligibility (GOV.UK)
          </a>
        ) : null}
        <a
          href={map.checkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          Challenge a decision (GOV.UK)
        </a>
        <a
          href={map.appealUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          Appeal a benefit decision
        </a>
      </div>
    </section>
  );
}

function scopeBandLabel(band: ActionPlanLegalAidMap["scopeBand"]) {
  switch (band) {
    case "often":
      return "Often relevant";
    case "sometimes":
      return "Sometimes relevant";
    case "rare":
      return "Rare";
    case "rarely_or_never":
      return "Rarely / not usually";
    default:
      return band;
  }
}

function LegalAidMapSection({ map }: { map: ActionPlanLegalAidMap }) {
  return (
    <section className="mt-8 border-t border-gold/20 pt-6">
      <h3 className="font-serif text-xl font-semibold text-foreground">
        Legal aid map for this claim
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{map.headline}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">
          Scope: {scopeBandLabel(map.scopeBand)}
        </span>
        {map.likelihood ? (
          <span className="rounded-full bg-secondary/50 px-2.5 py-1 font-medium text-foreground">
            Screen: {map.likelihood}
          </span>
        ) : null}
      </div>

      <ul className="mt-4 space-y-3">
        {map.doors.map((d) => (
          <li
            key={d.id}
            className="rounded-2xl border border-gold/25 bg-background/80 px-4 py-3"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="font-medium text-foreground">{d.title}</p>
              <span className="text-xs font-medium text-primary">
                {scopeBandLabel(d.band)}
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{d.summary}</p>
            {d.examples?.length ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Examples: {d.examples.join(" · ")}
              </p>
            ) : null}
            {d.url ? (
              <a
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs text-primary underline underline-offset-2"
              >
                Source
              </a>
            ) : null}
          </li>
        ))}
      </ul>

      <h4 className="mt-6 font-serif text-lg font-semibold text-foreground">Means rules (triage)</h4>
      <ul className="mt-3 space-y-2">
        {map.meansRules.map((r) => (
          <li key={r.id} className="text-sm leading-relaxed text-foreground/85">
            <span className="font-medium">{r.title}.</span> {r.summary}
          </li>
        ))}
      </ul>

      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{map.meritsNote}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{map.outOfScopeNote}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{map.honestNote}</p>

      <ul className="mt-4 list-none space-y-2">
        {map.nextSteps.map((s, i) => (
          <li key={i} className="flex gap-2.5 text-sm text-foreground/85">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" aria-hidden />
            <span>{s}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-primary">
        <a
          href={map.checkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          Check legal aid (GOV.UK)
        </a>
        <a
          href={map.findProviderUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          Find a legal-aid provider
        </a>
      </div>
    </section>
  );
}

function likelihoodLabel(l?: ActionPlanFinancingMap["options"][number]["likelihood"]) {
  switch (l) {
    case "often":
      return "Often fits";
    case "sometimes":
      return "Sometimes";
    case "rare":
      return "Rare";
    case "unlikely":
      return "Unlikely";
    default:
      return null;
  }
}

function roleLabel(role: ActionPlanFinancingMap["contacts"][number]["role"]) {
  switch (role) {
    case "funder":
      return "Litigation funder";
    case "broker":
      return "Broker / adviser";
    case "marketplace":
      return "Marketplace / panel";
    case "guidance":
      return "Official guidance";
    default:
      return role;
  }
}

function FinancingMapSection({ map }: { map: ActionPlanFinancingMap }) {
  return (
    <section className="mt-8 border-t border-gold/20 pt-6">
      <h3 className="font-serif text-xl font-semibold text-foreground">
        Financing map — claim to costs
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {map.complexity === "complex" ? "Complex claim profile. " : ""}
        {map.complexityReason}
      </p>

      <ul className="mt-4 space-y-3">
        {map.options.map((opt) => (
          <li
            key={opt.id}
            className="rounded-2xl border border-gold/25 bg-background/80 px-4 py-3"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="font-medium text-foreground">{opt.title}</p>
              {likelihoodLabel(opt.likelihood) ? (
                <span className="text-xs font-medium text-primary">
                  {likelihoodLabel(opt.likelihood)}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{opt.blurb}</p>
            {opt.url ? (
              <a
                href={opt.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs text-primary underline underline-offset-2"
              >
                {opt.sourceLabel || "Source"}
              </a>
            ) : null}
          </li>
        ))}
      </ul>

      {map.contacts.length ? (
        <>
          <h4 className="mt-6 font-serif text-lg font-semibold text-foreground">
            Who can help with financing
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Funders and brokers are selective — many claims will not be funded. Guidance links apply to everyone.
          </p>
          <ul className="mt-3 space-y-3">
            {map.contacts.map((c) => (
              <li
                key={c.id}
                className="rounded-2xl border border-border/50 bg-background/70 px-4 py-3"
              >
                <p className="font-medium text-foreground">{c.name}</p>
                <p className="mt-0.5 text-xs font-medium text-primary">{roleLabel(c.role)}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{c.blurb}</p>
                {c.url ? (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-xs text-primary underline underline-offset-2"
                  >
                    Open site
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{map.honestNote}</p>
    </section>
  );
}

function downloadBriefPdf(brief: LawyerBriefInput) {
  const bytes = buildLawyerBriefPdf(brief);
  const blob = new Blob([Uint8Array.from(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = briefFilename(brief.title);
  a.click();
  URL.revokeObjectURL(url);
}

function filterFreeServicesForNation(
  services: ActionPlanFreeService[],
  nation?: "england" | "wales" | "scotland" | "unknown" | null,
): ActionPlanFreeService[] {
  if (!nation || nation === "unknown") return services;
  return services.filter((s) => {
    const id = s.id.toLowerCase();
    const name = s.name.toLowerCase();
    if (
      nation === "england" &&
      (id.includes("cymru") || id.includes("wales") || /\bwales\b/.test(name))
    ) {
      return false;
    }
    if (nation === "wales" && (id.includes("scotland") || /\bscotland\b/.test(name))) {
      return false;
    }
    if (
      nation === "scotland" &&
      (id.includes("cymru") || id.includes("england") || /england\s*&\s*wales/.test(name))
    ) {
      return false;
    }
    return true;
  });
}

function FreeServicesPanel({
  services,
  guide,
  defaultOpen,
}: {
  services: ActionPlanFreeService[];
  guide?: ActionPlan["freeAdviceGuide"];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const visible = filterFreeServicesForNation(services, guide?.nation);
  if (!visible.length) return null;

  return (
    <section className="mt-6 rounded-2xl border-2 border-primary/25 bg-primary/5 p-4 md:p-5">
      <h3 className="font-serif text-xl font-semibold text-foreground">Free services</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Start here — people and organisations you can speak to without paying a solicitor first.
        {guide ? ` Using the ${guide.nationLabel} free-advice guide.` : ""}
      </p>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 sm:w-auto"
        >
          Show me free services
        </button>
      ) : (
        <>
          <ul className="mt-4 space-y-3">
            {visible.map((s) => (
              <li
                key={s.id}
                className="rounded-2xl border border-gold/25 bg-background/90 px-4 py-3"
              >
                <p className="font-medium text-foreground">{s.name}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.blurb}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-primary">
                  {s.phone ? <span>{s.phone}</span> : null}
                  {s.url ? (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2"
                    >
                      Open {s.name.split("—")[0]?.trim() || "site"}
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {guide ? (
            <div className="mt-4 space-y-2 text-xs text-muted-foreground">
              {guide.notes.slice(0, 2).map((n, i) => (
                <p key={i} className="leading-relaxed">
                  {n}
                </p>
              ))}
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-primary">
                <a
                  href={guide.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  {guide.pdfLabel}
                </a>
                <a
                  href={guide.hubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  All Pro Bono Week guides
                </a>
              </div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-3 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Hide free services
          </button>
        </>
      )}
    </section>
  );
}

function SolicitorFirmCard({
  firm,
  kind,
  story,
  title,
  plan,
  brief,
}: {
  firm: ActionPlanSolicitor;
  kind?: DisputeKind | null;
  story?: string;
  title?: string;
  plan?: ActionPlan | null;
  brief?: LawyerBriefInput | null;
}) {
  const [showReviews, setShowReviews] = useState(false);
  const [costNote, setCostNote] = useState<string | null>(null);
  const service = serviceLabelForKind(kind);
  const sraRequired = sraRequiresPublishedPrices(kind);
  const costs = firm.publishedCosts;
  const reviews = firm.reviews;

  function requestCosts() {
    const { mailtoUrl } = buildCostRequestEmail({
      firm,
      kind,
      story: brief?.summary || story,
      plan: plan || brief?.actionPlan || null,
      profileAnswers: brief?.profileAnswers || null,
      fundingPreference: brief?.fundingPreference || null,
      locationHint:
        brief?.profileAnswers?.solicitorLocation ||
        plan?.solicitorLocation ||
        null,
      clientName: brief?.clientName || null,
    });
    if (brief) {
      try {
        downloadBriefPdf(brief);
        setCostNote(
          `PDF brief downloaded — attach it in your email. We BCC ${COST_REQUEST_BCC} so we can learn typical costs.`,
        );
      } catch {
        setCostNote(
          `Opening your email. We BCC ${COST_REQUEST_BCC}. Download your brief from Your case if you want to attach the PDF.`,
        );
      }
    } else {
      setCostNote(
        `Opening your email with a triage summary. We BCC ${COST_REQUEST_BCC}. Sign in and open Your case to attach a PDF brief.`,
      );
    }
    window.location.href = mailtoUrl;
  }

  return (
    <li className="rounded-2xl border border-gold/25 bg-background/90 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium text-foreground">{firm.name}</p>
        {firm.legalAid ? (
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            Legal aid
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{firm.blurb}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-primary">
        {[firm.city, firm.postcode].filter(Boolean).length ? (
          <span className="text-muted-foreground">
            {[firm.city, firm.postcode].filter(Boolean).join(" · ")}
          </span>
        ) : null}
        {firm.phone ? <span>{firm.phone}</span> : null}
        {firm.url ? (
          <a
            href={firm.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            SRA profile
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => setShowReviews((v) => !v)}
          className="underline underline-offset-2"
        >
          {showReviews ? "Hide reviews" : "Reviews"}
        </button>
      </div>

      {showReviews ? (
        <div className="mt-3 rounded-xl border border-border/50 bg-background/80 px-3 py-2.5 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Reviews on Legal Shaman
          </p>
          {reviews?.rating || reviews?.reviewCount || reviews?.summary ? (
            <>
              {reviews.summary ? (
                <p className="mt-1 text-foreground/90">{reviews.summary}</p>
              ) : (
                <p className="mt-1 text-foreground/90">
                  {reviews.rating ? `${reviews.rating.toFixed(1)} rating` : "Rating on file"}
                  {reviews.reviewCount
                    ? ` · ${reviews.reviewCount} review${reviews.reviewCount === 1 ? "" : "s"}`
                    : ""}
                </p>
              )}
              {reviews.snippets?.length ? (
                <ul className="mt-2 space-y-2">
                  {reviews.snippets.map((snip, i) => (
                    <li key={i} className="text-xs leading-relaxed text-muted-foreground">
                      “{snip.text}”
                      {snip.source ? (
                        <span className="mt-0.5 block text-[10px] text-muted-foreground/80">
                          {snip.source}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="mt-1 text-muted-foreground">
              No reviews on Legal Shaman yet for this firm. We keep ratings here when we have them
              so you do not have to leave the site.
            </p>
          )}
        </div>
      ) : null}

      <div className="mt-3 rounded-xl border border-border/40 bg-background/60 px-3 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          Costs for {service}
        </p>
        {costs ? (
          <>
            <p className="mt-1 text-sm leading-relaxed text-foreground/90">{costs.summary}</p>
            {costs.sourceUrl ? (
              <a
                href={costs.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-xs text-primary underline underline-offset-2"
              >
                Firm fees / website
              </a>
            ) : null}
          </>
        ) : (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {sraRequired
              ? `SRA rules usually require firms to publish prices for ${service}. We do not have their published figures here yet.`
              : `We do not have published ${service} fees for this firm on Legal Shaman yet (family/divorce fees are often voluntary, not an SRA-mandated price list).`}
          </p>
        )}
        <button
          type="button"
          onClick={requestCosts}
          className="mt-2 inline-flex h-9 items-center justify-center rounded-lg border border-primary/35 bg-primary/5 px-3 text-xs font-semibold text-primary hover:bg-primary/10"
        >
          {firm.email ? "Email them for costs" : "Ask for costs (opens email)"}
        </button>
        {costNote ? <p className="mt-2 text-[11px] text-muted-foreground">{costNote}</p> : null}
      </div>
    </li>
  );
}

function SolicitorSearchPanel({
  initialSolicitors,
  initialMode,
  initialLocation,
  kind,
  story,
  title,
  plan,
  brief,
  onPlanPatch,
}: {
  initialSolicitors: ActionPlanSolicitor[];
  initialMode?: ActionPlan["solicitorMatchMode"];
  initialLocation?: string | null;
  kind?: DisputeKind | null;
  story?: string;
  title?: string;
  plan?: ActionPlan | null;
  brief?: LawyerBriefInput | null;
  onPlanPatch?: (patch: Partial<ActionPlan>) => void;
}) {
  // Always start behind the CTA — even if an older plan already had solicitor hits.
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [solicitors, setSolicitors] = useState<ActionPlanSolicitor[]>([]);
  const [location, setLocation] = useState(initialLocation || "");
  const [legalAidOnly, setLegalAidOnly] = useState(false);
  const [mode, setMode] = useState<ActionPlan["solicitorMatchMode"]>(
    initialMode || (initialLocation ? "local" : "unsure"),
  );
  const cachedInitial = initialSolicitors;

  async function runSearch(opts: {
    locationHint: string;
    mode: ActionPlan["solicitorMatchMode"];
    legalAidOnly: boolean;
  }) {
    if (!story?.trim()) {
      setError("We need a short description of your matter before searching solicitors.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(resolveApiUrl("/api/cases/recommend-solicitors"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: kind || "general",
          story,
          mode: opts.mode || "unsure",
          locationHint: opts.locationHint || "",
          legalAidOnly: opts.legalAidOnly,
        }),
      });
      if (!res.ok) {
        setError("Solicitor search failed — try again in a moment.");
        return;
      }
      const data = (await res.json()) as { solicitors?: ActionPlanSolicitor[] };
      const next = data.solicitors || [];
      setSolicitors(next);
      setMode(opts.mode);
      onPlanPatch?.({
        matchedSolicitors: next,
        solicitorMatchMode: opts.mode,
        solicitorLocation: opts.locationHint || null,
      });
      if (!next.length) {
        setError(
          opts.legalAidOnly
            ? opts.locationHint
              ? `No legal aid matches near “${opts.locationHint}” yet — try a nearby town, or untick Legal aid.`
              : "No legal aid matches yet — add a town or postcode, or untick Legal aid."
            : opts.locationHint
              ? `No SRA matches near “${opts.locationHint}” yet — try a nearby town or a broader postcode area.`
              : "No solicitor matches yet — add a town or postcode to refine.",
        );
      }
    } catch {
      setError("Solicitor search failed — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const subtitle = legalAidOnly
    ? location.trim()
      ? `Legal aid providers near ${location.trim()}.`
      : "Legal aid providers from our index."
    : mode === "local" && location.trim()
      ? `From our SRA register near ${location.trim()}.`
      : mode === "local"
        ? "From our SRA register near you."
        : "From our SRA register — refine by town or postcode if you want someone closer.";

  return (
    <section className="mt-6 rounded-2xl border border-border/60 bg-background/70 p-4 md:p-5">
      <h3 className="font-serif text-xl font-semibold text-foreground">
        Need a solicitor instead?
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        If the free services above are not enough, you can search regulated firms next. You can
        refine by city or postcode, and tick Legal aid if you need a legal-aid provider.
      </p>

      {!started ? (
        <button
          type="button"
          onClick={() => {
            setStarted(true);
            if (cachedInitial.length && !location.trim() && !legalAidOnly) {
              setSolicitors(cachedInitial);
              return;
            }
            void runSearch({
              locationHint: location.trim(),
              mode: location.trim() ? "local" : "unsure",
              legalAidOnly,
            });
          }}
          className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl border-2 border-primary/40 bg-background px-5 text-sm font-semibold text-primary hover:bg-primary/10 sm:w-auto"
        >
          If these don’t help, look for a solicitor
        </button>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1 text-sm">
              <span className="mb-1 block font-medium text-foreground">
                Refine by town or postcode (optional)
              </span>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Leeds or LS1"
                className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none ring-primary focus:ring-2"
              />
            </label>
            <button
              type="button"
              disabled={loading}
              onClick={() =>
                void runSearch({
                  locationHint: location.trim(),
                  mode: location.trim() ? "local" : "unsure",
                  legalAidOnly,
                })
              }
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {loading ? "Searching…" : location.trim() ? "Refine search" : "Search solicitors"}
            </button>
          </div>

          <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={legalAidOnly}
              onChange={(e) => {
                const next = e.target.checked;
                setLegalAidOnly(next);
                void runSearch({
                  locationHint: location.trim(),
                  mode: location.trim() ? "local" : "unsure",
                  legalAidOnly: next,
                });
              }}
              className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            <span>
              Legal aid only{" "}
              <span className="text-muted-foreground">
                (show firms / providers that offer legal aid)
              </span>
              {legalAidOnly ? (
                <a
                  href="https://www.gov.uk/check-legal-aid"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block text-xs text-primary underline underline-offset-2"
                >
                  Also check legal aid on GOV.UK
                </a>
              ) : null}
            </span>
          </label>

          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

          {solicitors.length ? (
            <>
              <p className="mt-4 text-sm text-muted-foreground">{subtitle}</p>
              <ul className="mt-3 space-y-3">
                {solicitors.map((s) => (
                  <SolicitorFirmCard
                    key={s.id}
                    firm={s}
                    kind={kind}
                    story={story}
                    title={title}
                    plan={plan}
                    brief={brief}
                  />
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Always verify the firm on the{" "}
                <a
                  href="https://www.sra.org.uk/consumers/register/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  SRA register
                </a>{" "}
                before you instruct anyone. Cost-request emails BCC Legal Shaman (
                {COST_REQUEST_BCC}) so we can learn typical fees.
              </p>
            </>
          ) : loading ? (
            <p className="mt-4 text-sm text-muted-foreground">
              {legalAidOnly ? "Searching legal aid providers…" : "Searching the SRA register…"}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Soft-fix older jammed option paragraphs so bullets still space out. */
function normalizeDetail(detail: string): string {
  let trimmed = detail
    .replace(/\[Source\]\((https?:\/\/[^)\s]+)\)/gi, " (Source)")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/([.!?])([A-Za-z])/g, "$1 $2")
    .trim();
  if (!trimmed) return "";
  if (trimmed.includes("\n") || /(?:^|\n)\s*[•*-]\s+/.test(trimmed)) return trimmed;

  // Split before common option titles when older plans jammed them into one line.
  trimmed = trimmed
    .replace(/\s+This is guidance to help you act[^.]*\./gi, "")
    .replace(
      /\s+(?=(?:Talk or write|Keep a log|Council or mediation|Apply together|Apply on your own|Children arrangements|Money and property|Agree without|Confirm your tenancy|Gather evidence|Raise it(?: at work)?|Escalation routes|ACAS|Employment tribunal|Complain to the trader|Card or finance|Alternative dispute|Sort priority|Budget and contact|Formal options|Clarify the problem|Get a free check)[:])/g,
      "\n• ",
    );

  if (trimmed.includes("\n• ")) {
    const [overview, ...rest] = trimmed.split("\n");
    return [overview.trim(), "", ...rest.map((l) => l.trim()).filter(Boolean)].join("\n");
  }

  // Generic: "Title: explanation. Title2: explanation"
  const parts = trimmed.split(/(?<=\.)\s+(?=[A-Z][^.]{0,48}:\s)/);
  if (parts.length < 2) return trimmed;
  const [overview, ...rest] = parts;
  return [overview, "", ...rest.map((p) => `• ${p.trim()}`)].join("\n");
}

/** Render plan detail with spaced paragraphs and proper bullet lists. */
function StepDetail({ detail }: { detail: string }) {
  const blocks = normalizeDetail(detail)
    .split(/\n\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  if (!blocks.length) return null;

  return (
    <div className="mt-2 space-y-3 text-sm leading-relaxed text-foreground/85 md:text-[0.95rem]">
      {blocks.map((block, i) => {
        const lines = block
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        const bulletLines = lines.filter((l) => /^[-•*]\s+/.test(l));
        const isList = bulletLines.length >= 1 && bulletLines.length === lines.length;

        if (isList) {
          return (
            <ul key={i} className="list-none space-y-2.5 pl-0">
              {lines.map((line, j) => (
                <li key={j} className="flex gap-2.5">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" aria-hidden />
                  <span className="min-w-0 flex-1">
                    {line.replace(/^[-•*]\s+/, "")}
                  </span>
                </li>
              ))}
            </ul>
          );
        }

        // Mixed: lead sentence then bullets
        if (bulletLines.length > 0) {
          const lead = lines.filter((l) => !/^[-•*]\s+/.test(l));
          const bullets = lines.filter((l) => /^[-•*]\s+/.test(l));
          return (
            <div key={i} className="space-y-2.5">
              {lead.map((line, j) => (
                <p key={`l-${j}`}>{line}</p>
              ))}
              <ul className="list-none space-y-2.5 pl-0">
                {bullets.map((line, j) => (
                  <li key={j} className="flex gap-2.5">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" aria-hidden />
                    <span className="min-w-0 flex-1">
                      {line.replace(/^[-•*]\s+/, "")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        }

        return (
          <p key={i} className="whitespace-pre-wrap">
            {block}
          </p>
        );
      })}
    </div>
  );
}

export function ActionPlanView({
  plan,
  title = "Your results",
  kind,
  story,
  preferFreeOpen = false,
  brief,
  onPlanPatch,
}: {
  plan: ActionPlan;
  title?: string;
  kind?: DisputeKind | null;
  story?: string;
  /** When true, expand free services without an extra click. Default stays behind the CTA. */
  preferFreeOpen?: boolean;
  /** Optional matter brief for cost-request PDF attachment. */
  brief?: LawyerBriefInput | null;
  onPlanPatch?: (patch: Partial<ActionPlan>) => void;
}) {
  const freeServices = plan.freeServices || [];
  const matchedSolicitors = plan.matchedSolicitors || [];
  const financingMap = plan.financingMap || null;
  const legalAidMap = plan.legalAidMap || null;
  const ucMap = plan.universalCreditMap || null;
  const timeline = plan.timeline || [];
  const costBrief: LawyerBriefInput | null =
    brief ||
    ({
      title: title || "Your situation",
      summary: story || null,
      matterType: kind || null,
      actionPlan: plan,
      profileAnswers: null,
      fundingPreference: null,
      generatedAt: new Date().toISOString(),
    } satisfies LawyerBriefInput);
  return (
    <section className="rounded-3xl border-2 border-gold/30 bg-card/95 p-5 shadow-sm md:p-7">
      <h2 className="font-serif text-2xl font-semibold text-foreground md:text-3xl">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Free help first. Then, only if you need it, search for a solicitor. Not a solicitor; not
        legal advice.
      </p>

      {timeline.length ? (
        <div className="mt-6 rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <h3 className="font-serif text-lg font-semibold text-foreground">Your timeline</h3>
          <ol className="mt-3 space-y-3">
            {timeline.map((item) => (
              <li key={item.id} className="text-sm">
                <p className="font-medium text-foreground">
                  {item.band === "this_week"
                    ? "This week"
                    : item.band === "before_deadline"
                      ? "Before deadline"
                      : "Later"}
                  {" — "}
                  {item.label}
                </p>
                <p className="mt-1 text-muted-foreground leading-relaxed">{item.detail}</p>
                {item.dueHint ? (
                  <p className="mt-1 text-xs font-medium text-primary">Diary: {item.dueHint}</p>
                ) : null}
                {item.wikiPath ? (
                  <p className="mt-1 text-xs">
                    <a
                      href={item.wikiPath}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      Read guide{item.wikiTitle ? `: ${item.wikiTitle}` : ""} →
                    </a>
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={`/financing?kind=${encodeURIComponent(kind || "general")}&story=${encodeURIComponent((story || title || "").slice(0, 400))}`}
          className="inline-flex h-9 items-center rounded-xl border border-primary/40 bg-background px-3 text-sm font-medium text-primary hover:bg-primary/10"
        >
          Explore financing options
        </a>
        <a
          href="/blog"
          className="inline-flex h-9 items-center rounded-xl border border-border/70 bg-background px-3 text-sm font-medium text-foreground/80 hover:border-primary/40"
        >
          Browse Blog / wiki
        </a>
      </div>

      <FreeServicesPanel
        services={freeServices}
        guide={plan.freeAdviceGuide}
        defaultOpen={preferFreeOpen}
      />

      <SolicitorSearchPanel
        initialSolicitors={matchedSolicitors}
        initialMode={plan.solicitorMatchMode}
        initialLocation={plan.solicitorLocation}
        kind={kind}
        story={story}
        title={title}
        plan={plan}
        brief={costBrief}
        onPlanPatch={onPlanPatch}
      />

      <ol className="mt-8 space-y-6 border-t border-gold/20 pt-6">
        {plan.steps
          .filter((step) => {
            if (step.id === "free-services") return false;
            if (step.id === "solicitor-match" || step.id === "solicitors") return false;
            // Rich sections below — avoid duplicating long menus in the numbered list.
            if (financingMap && step.id === "financing") return false;
            if (legalAidMap && step.id === "legal-aid-map") return false;
            if (ucMap && step.id === "universal-credit-map") return false;
            return true;
          })
          .map((step, index) => (
            <li key={step.id} className="flex gap-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 font-serif text-sm font-bold text-primary">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1 border-b border-border/40 pb-6 last:border-0 last:pb-0">
                <h3 className="font-serif text-lg font-semibold text-foreground">{step.label}</h3>
                <StepDetail detail={step.detail} />
                {step.wikiPath ? (
                  <p className="mt-2 text-xs">
                    <a
                      href={step.wikiPath}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      Related guide{step.wikiTitle ? `: ${step.wikiTitle}` : ""} →
                    </a>
                  </p>
                ) : null}
                {step.url === "/financing" ? (
                  <p className="mt-2 text-xs">
                    <a
                      href={`/financing?kind=${encodeURIComponent(kind || "general")}&story=${encodeURIComponent((story || "").slice(0, 400))}`}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      Open financing tool →
                    </a>
                  </p>
                ) : null}
                {step.spendAdvice ? (
                  <p className="mt-3 text-xs font-medium text-primary">{step.spendAdvice}</p>
                ) : null}
              </div>
            </li>
          ))}
      </ol>
      {ucMap ? <UcMapSection map={ucMap} /> : null}
      {legalAidMap ? <LegalAidMapSection map={legalAidMap} /> : null}
      {financingMap ? <FinancingMapSection map={financingMap} /> : null}
    </section>
  );
}
