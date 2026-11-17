"use client";

import type {
  ActionPlan,
  ActionPlanFinancingMap,
  ActionPlanFreeService,
  ActionPlanLegalAidMap,
  ActionPlanSolicitor,
  ActionPlanUcMap,
} from "@/lib/cases/types";

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

function googleReviewsSearchUrl(name: string, city?: string): string {
  const q = [name, "reviews", city].filter(Boolean).join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

function MatchedSolicitorsList({
  solicitors,
  mode,
  location,
}: {
  solicitors: ActionPlanSolicitor[];
  mode?: ActionPlan["solicitorMatchMode"];
  location?: string | null;
}) {
  if (!solicitors.length) return null;
  const subtitle =
    mode === "local" && location
      ? `From our SRA register near ${location}.`
      : mode === "local"
        ? "From our SRA register near you."
        : mode === "online"
          ? "From our SRA register — firms you can approach online."
          : mode === "reviews"
            ? "From our SRA register — compare public reviews before you instruct."
            : "From our SRA register.";

  return (
    <section className="mt-8 border-t border-gold/20 pt-6">
      <h3 className="font-serif text-xl font-semibold text-foreground">
        Solicitors from our SRA register
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      <ul className="mt-4 space-y-3">
        {solicitors.map((s) => (
          <li
            key={s.id}
            className="rounded-2xl border border-gold/25 bg-background/80 px-4 py-3"
          >
            <p className="font-medium text-foreground">{s.name}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {s.blurb}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-primary">
              {[s.city, s.postcode].filter(Boolean).length ? (
                <span className="text-muted-foreground">
                  {[s.city, s.postcode].filter(Boolean).join(" · ")}
                </span>
              ) : null}
              {s.phone ? <span>{s.phone}</span> : null}
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  SRA profile
                </a>
              ) : null}
              <a
                href={googleReviewsSearchUrl(s.name, s.city)}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                Check reviews
              </a>
            </div>
          </li>
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
        before you instruct anyone.
      </p>
    </section>
  );
}

function FreeServicesList({
  services,
  guide,
}: {
  services: ActionPlanFreeService[];
  guide?: ActionPlan["freeAdviceGuide"];
}) {
  if (!services.length) return null;
  return (
    <section className="mt-8 border-t border-gold/20 pt-6">
      <h3 className="font-serif text-xl font-semibold text-foreground">
        Free services that may apply
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Named doors for this kind of problem — check them before you pay privately.
        {guide
          ? ` Mapped using the Pro Bono Week guides for ${guide.nationLabel}.`
          : ""}
      </p>
      <ul className="mt-4 space-y-3">
        {services.map((s) => (
          <li
            key={s.id}
            className="rounded-2xl border border-gold/25 bg-background/80 px-4 py-3"
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
}: {
  plan: ActionPlan;
  title?: string;
}) {
  const freeServices = plan.freeServices || [];
  const matchedSolicitors = plan.matchedSolicitors || [];
  const financingMap = plan.financingMap || null;
  const legalAidMap = plan.legalAidMap || null;
  const ucMap = plan.universalCreditMap || null;
  return (
    <section className="rounded-3xl border-2 border-gold/30 bg-card/95 p-5 shadow-sm md:p-7">
      <h2 className="font-serif text-2xl font-semibold text-foreground md:text-3xl">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        A helpful map to access justice — we signpost options, claim next steps, legal aid, Universal Credit paths, financing, and solicitor costs. Not a solicitor; not legal advice.
      </p>
      <ol className="mt-6 space-y-6">
        {plan.steps
          .filter((step) => {
            if (step.id === "free-services") return false;
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
      <MatchedSolicitorsList
        solicitors={matchedSolicitors}
        mode={plan.solicitorMatchMode}
        location={plan.solicitorLocation}
      />
      <FreeServicesList services={freeServices} guide={plan.freeAdviceGuide} />
    </section>
  );
}
