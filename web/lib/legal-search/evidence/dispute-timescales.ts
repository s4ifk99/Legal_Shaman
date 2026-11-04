import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";
import type { DisputeTimescale } from "@/lib/legal-search/evidence/types";

const NO_OFFICIAL_RANGE = "No official timescale is on file for this kind of dispute.";

const EMPLOYMENT_GUIDE =
  "https://www.gov.uk/government/publications/employment-tribunals-after-your-claim-is-accepted-t421/employment-tribunal-what-happens-after-you-submit-a-claim-t421";

const CIVIL_STATS_Q2_2026 =
  "https://www.gov.uk/government/statistics/civil-justice-statistics-quarterly-april-to-june-2026/civil-justice-statistics-quarterly-april-to-june-2026";

const TRIBUNAL_STATS_Q2_2026 =
  "https://www.gov.uk/government/statistics/tribunals-statistics-quarterly-april-to-june-2026/tribunal-statistics-quarterly-april-to-june-2026";

const POSSESSION_RULE = "https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part55";

/**
 * Official ranges only. Each high-confidence sentence is copied in scope from the linked page.
 * Areas without a citable official range stay low confidence. No guessed months.
 */
const CITED: Record<string, Omit<DisputeTimescale, "matterLabel">> = {
  employment: {
    label: "How long this kind of dispute takes",
    rangeText:
      "After a claim is accepted, GOV.UK estimates about 26 weeks for case management, then a judgment within 4 weeks of the final hearing. The respondent has 28 days to reply. Many cases settle earlier.",
    confidence: "high",
    sourceName: "GOV.UK employment tribunal guide (T421), updated 9 March 2026",
    sourceUrl: EMPLOYMENT_GUIDE,
  },
  housing: {
    label: "How long this kind of dispute takes",
    rangeText:
      "For a standard possession claim, the first hearing is not less than 28 days after the claim is issued, and the standard period is not more than 8 weeks. The court can change that time. This is the first hearing, not the end of the dispute, and it does not cover every landlord and tenant problem.",
    confidence: "high",
    sourceName: "Civil Procedure Rules, rule 55.5",
    sourceUrl: POSSESSION_RULE,
  },
  consumer: {
    label: "How long this kind of dispute takes",
    rangeText:
      "For defended small claims that reached a trial, the national median from issue to trial was 41.0 weeks in April to June 2026. Claims that settle earlier are not included.",
    confidence: "high",
    sourceName: "Civil justice statistics quarterly, April to June 2026",
    sourceUrl: CIVIL_STATS_Q2_2026,
  },
  debt: {
    label: "How long this kind of dispute takes",
    rangeText:
      "For defended small claims that reached a trial, the national median from issue to trial was 41.0 weeks in April to June 2026. Claims that settle earlier are not included.",
    confidence: "high",
    sourceName: "Civil justice statistics quarterly, April to June 2026",
    sourceUrl: CIVIL_STATS_Q2_2026,
  },
  immigration: {
    label: "How long this kind of dispute takes",
    rangeText:
      "Immigration and asylum appeals cleared in April to June 2026 took a mean of 65 weeks. That figure is for appeals the tribunal cleared, not for visa decision times, and it varies by case type.",
    confidence: "high",
    sourceName: "Tribunal statistics quarterly, April to June 2026",
    sourceUrl: TRIBUNAL_STATS_Q2_2026,
  },
};

const matterNameBySlug = new Map(LEGAL_ISSUE_TAXONOMY.map((entry) => [entry.slug, entry.canonicalName]));

export function disputeTimescaleForSlug(slug: string | null | undefined): DisputeTimescale {
  const key = slug?.trim() || "";
  const matterLabel = matterNameBySlug.get(key) ?? "This dispute";
  const cited = key ? CITED[key] : undefined;
  if (!cited) {
    return {
      label: "How long this kind of dispute takes",
      rangeText: NO_OFFICIAL_RANGE,
      confidence: "low",
      matterLabel,
    };
  }
  return { ...cited, matterLabel };
}
