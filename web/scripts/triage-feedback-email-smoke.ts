/**
 * Smoke test for triage summary email builder (no send).
 * Run: cd web && npx tsx scripts/triage-feedback-email-smoke.ts
 */
import { buildTriageSummaryEmail } from "../lib/email/triage-summary-template";

const built = buildTriageSummaryEmail({
  to: "test@example.com",
  sessionId: "test-session-123",
  mergedQuery: "unfair dismissal legal aid Manchester",
  resultCount: 5,
  sectionTitles: ["Legal aid", "Private solicitors"],
  reviewConsent: true,
});

if (!built.subject.includes("Legal Shaman")) {
  throw new Error("missing subject");
}
if (!built.text.includes("test-session-123")) {
  throw new Error("missing session reference");
}
if (!built.html.includes("unfair dismissal")) {
  throw new Error("missing query in html");
}

console.log("triage-feedback-email-smoke: OK");
console.log("subject:", built.subject);
