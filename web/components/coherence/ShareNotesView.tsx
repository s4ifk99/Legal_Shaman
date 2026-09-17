"use client";

import { useState } from "react";
import type { SolicitorBriefV0 } from "@/lib/coherence/briefSchema";
import { briefToJsonDownload } from "@/lib/coherence/brief";
import { SpiralDecoration } from "@/components/spiral-decoration";
import "./ShareNotesView.css";

type Props = {
  brief: SolicitorBriefV0;
  publishedAt: string;
  expiresAt: string;
};

const LIMITATION_LABELS: Record<string, string> = {
  safety_risk_flagged: "Safety risk flagged",
  mode_urgent: "Marked urgent at intake",
  urgent_human: "Needs urgent human review",
  emergency_services_info: "Emergency services information shown",
};

export function ShareNotesView({ brief, publishedAt, expiresAt }: Props) {
  const [openSpan, setOpenSpan] = useState<number | null>(null);
  const urgency = Array.from(
    new Set(brief.issues.flatMap((issue) => [...issue.urgency_flags, ...issue.limitation_flags])),
  );

  function copyText() {
    const lines = [
      "LEGAL SHAMAN — Notes for your Lawyer",
      "legalshaman.com · Justice through Search",
      "",
      "NOTES FOR YOUR LAWYER",
      "",
      "Desired outcome:",
      brief.client_goal.stated,
      "",
      ...(brief.client_narrative_raw
        ? ["In the client’s words:", brief.client_narrative_raw, ""]
        : []),
      "Chronology:",
      ...brief.timeline.map(
        (row) =>
          `${row.order}. [${row.date_approx || "Date not given"}] ${row.event}${
            row.client_confirmed ? "" : " [inferred]"
          }`,
      ),
      "",
      "Situation summary:",
      brief.matter_summary_plain,
    ];
    void navigator.clipboard?.writeText(lines.join("\n"));
  }

  function downloadJson() {
    const json = briefToJsonDownload(brief);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${brief.brief_id || "solicitor-brief"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="share-notes">
      <header className="share-notes__masthead">
        <div className="share-notes__spiral share-notes__spiral--right no-print" aria-hidden>
          <SpiralDecoration size={180} color="var(--teal)" />
        </div>
        <div className="share-notes__spiral share-notes__spiral--left no-print" aria-hidden>
          <SpiralDecoration size={140} color="var(--coral)" />
        </div>
        <a href="/" className="share-notes__wordmark" aria-label="Legal Shaman home">
          <img
            src="/legal-shaman-header-transparent.png"
            alt="Legal Shaman"
            width={1024}
            height={114}
          />
        </a>
        <div className="share-notes__actions no-print">
          <button type="button" onClick={copyText}>
            Copy text
          </button>
          <button type="button" onClick={downloadJson}>
            Download JSON
          </button>
          <button type="button" className="share-notes__solid" onClick={() => window.print()}>
            Print / PDF
          </button>
        </div>
      </header>

      <div className="share-notes__identity">
        <a href="/" aria-hidden="true" tabIndex={-1}>
          <img
            src="/logo.jpg"
            alt=""
            width={72}
            height={72}
            className="share-notes__logo"
          />
        </a>
        <div>
          <p className="share-notes__kicker">
            Client chronology for instruction — not a court chronology or legal advice.
          </p>
          <h1>Notes for your Lawyer</h1>
          <p className="share-notes__tagline">Justice through Search</p>
        </div>
      </div>
      <p className="share-notes__meta">
        {brief.matter_type.replace(/_/g, " ")} · {brief.jurisdiction_label} · Published{" "}
        {new Date(publishedAt).toLocaleString("en-GB")} · Link expires{" "}
        {new Date(expiresAt).toLocaleString("en-GB")}
        {brief.risk_and_safety.routing !== "standard"
          ? ` · Risk: ${brief.risk_and_safety.routing.replace(/_/g, " ")}`
          : ""}
      </p>

      {urgency.length > 0 && (
        <ul className="share-notes__flags">
          {urgency.map((flag) => (
            <li key={flag}>{LIMITATION_LABELS[flag] || flag.replace(/_/g, " ")}</li>
          ))}
        </ul>
      )}

      <section>
        <h2>Desired outcome</h2>
        <p>{brief.client_goal.stated}</p>
      </section>

      {brief.client_narrative_raw ? (
        <section>
          <h2>In the client’s words</h2>
          <p className="share-notes__pre">{brief.client_narrative_raw}</p>
        </section>
      ) : null}

      <section>
        <h2>Chronology</h2>
        {brief.timeline.length === 0 ? (
          <p>No timeline events captured.</p>
        ) : (
          <div className="share-notes__table-wrap">
            <table className="share-notes__table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>What happened</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {brief.timeline.map((row) => {
                  const evidence = [
                    ...(row.documents || []),
                    ...(row.actors.length ? [`People: ${row.actors.join(', ')}`] : []),
                  ]
                    .filter(Boolean)
                    .join('; ')
                  return (
                    <tr key={row.order}>
                      <td>{row.date_approx || 'Date not given'}</td>
                      <td>
                        <button
                          type="button"
                          className="share-notes__event"
                          onClick={() =>
                            setOpenSpan((current) => (current === row.order ? null : row.order))
                          }
                        >
                          {row.event}
                        </button>
                        {!row.client_confirmed ? (
                          <span className="share-notes__quiet"> Inferred from intake</span>
                        ) : null}
                        {openSpan === row.order && row.source_span ? (
                          <p className="share-notes__quote">{row.source_span}</p>
                        ) : null}
                      </td>
                      <td>{evidence || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Situation summary</h2>
        <p className="share-notes__pre">{brief.matter_summary_plain}</p>
      </section>

      {brief.parties.length > 0 && (
        <section>
          <h2>Parties</h2>
          <ul>
            {brief.parties.map((party) => (
              <li key={party.name_or_label}>
                {party.name_or_label}
                {party.role ? ` (${party.role})` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {brief.documents_mentioned.length > 0 && (
        <section>
          <h2>Documents mentioned</h2>
          <ul>
            {brief.documents_mentioned.map((doc) => (
              <li key={doc.label}>
                {doc.label} ({doc.status.replace(/_/g, " ")})
              </li>
            ))}
          </ul>
        </section>
      )}

      {brief.open_questions.length > 0 && (
        <section>
          <h2>Open questions</h2>
          <ul>
            {brief.open_questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="share-notes__disclaimer">{brief.system_boundaries.disclaimer}</p>
      {brief.system_boundaries.urgent_help && (
        <p className="share-notes__urgent">{brief.system_boundaries.urgent_help}</p>
      )}

      <footer className="share-notes__colophon">
        <a href="/" aria-label="Legal Shaman home">
          <img
            src="/logo.jpg"
            alt=""
            width={40}
            height={40}
            className="share-notes__logo share-notes__logo--small"
          />
        </a>
        <div>
          <p className="share-notes__colophon-brand">
            <a href="/">Legal Shaman</a>
          </p>
          <p>
            Prepared on Legal Shaman ·{" "}
            <a href="/">legalshaman.com</a>
            {" · "}
            Not legal advice
          </p>
        </div>
      </footer>
    </div>
  );
}
