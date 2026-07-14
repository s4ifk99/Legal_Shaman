import { detectFundingIntent } from "@/lib/legal-search/funding-intent";
import { buildExpandedSearchText, resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";
import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";

import type { LegalSearchContext } from "./search-context";
import type { LegalSearchIntent } from "./search-intent";
import { classifyLegalIssue, inferHousingSubIssue } from "./classify";
import type { IssueClassification, LegalSearchRequest, SearchCriterion } from "./types";

export type DecomposeQueryInput = Pick<
  LegalSearchRequest,
  "query" | "location" | "jurisdiction" | "includeDirectory"
> & {
  context?: LegalSearchContext;
  intent?: LegalSearchIntent;
};

function matchedUserPhrases(query: string, taxonomySlug: string | undefined): string[] {
  if (!taxonomySlug) return [];
  const entry = LEGAL_ISSUE_TAXONOMY.find((e) => e.slug === taxonomySlug);
  if (!entry) return [];
  const lower = query.toLowerCase();
  const phrases = [
    ...entry.userPhrases,
    ...entry.aliases,
    ...entry.subIssues,
    entry.canonicalName,
  ];
  return phrases
    .filter((p) => p.length >= 3 && lower.includes(p.toLowerCase()))
    .slice(0, 4);
}

function situationSummary(query: string): string {
  const cleaned = query.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 160) return cleaned;
  return `${cleaned.slice(0, 157)}…`;
}

function helpRouteText(
  funding: ReturnType<typeof detectFundingIntent>,
  classification: IssueClassification,
  includeDirectory: boolean,
): string {
  const parts: string[] = [];
  if (funding === "legal_aid") parts.push("prioritise legal aid providers");
  else if (funding === "free_help") parts.push("prioritise free advice and pro bono help");
  else if (funding === "private") parts.push("include regulated private solicitors");
  else parts.push("show free help, legal aid, and regulated providers where relevant");

  if (classification.urgency === "emergency") {
    parts.unshift("surface emergency signposting routes first");
  }
  if (includeDirectory) parts.push("search lawyer/signpost directory alongside legal guidance");
  return parts.join("; ");
}

function sourcePreferenceText(): string {
  return "Prefer official UK guidance first (GOV.UK, Citizens Advice, ACAS, Shelter), then curated Legal Shaman wiki, before generic law firm marketing pages.";
}

function retrievalText(expanded: string, includeDirectory: boolean, intent?: LegalSearchIntent): string {
  const terms = expanded
    .split(/\s+/)
    .filter((t) => t.length >= 4)
    .slice(0, 8)
    .join(", ");
  const modes = ["keyword match on your wording", "semantic similarity when embeddings are available"];
  if (includeDirectory) modes.push("directory practice-area match");
  const intentNote = intent?.specificIssue ? `; issue focus: ${intent.specificIssue}` : "";
  return `${modes.join(" + ")}${terms ? `; boosted terms: ${terms}` : ""}${intentNote}`;
}

let criterionCounter = 0;
function criterion(
  kind: SearchCriterion["kind"],
  label: string,
  text: string,
  emphasis: SearchCriterion["emphasis"] = "normal",
): SearchCriterion {
  criterionCounter += 1;
  return { id: `c-${criterionCounter}`, kind, label, text, emphasis };
}

/** Break a natural-language legal query into Exa-style visible search criteria. */
export function decomposeLegalSearchQuery(input: DecomposeQueryInput): SearchCriterion[] {
  criterionCounter = 0;
  const query = input.query.trim();
  const includeDirectory = input.includeDirectory !== false;
  const jurisdiction = input.jurisdiction?.trim() || "England and Wales";

  if (query.length < 2) return [];

  const classification = input.context?.classification ?? classifyLegalIssue(query);
  const resolution = input.context?.resolution ?? resolveLegalIssueFromQuery(query);
  const funding = detectFundingIntent(query);
  const expanded = buildExpandedSearchText(resolution, query);
  const matched = matchedUserPhrases(query, classification.subArea || undefined);
  const intent = input.intent;

  const criteria: SearchCriterion[] = [];

  criteria.push(
    criterion(
      "situation",
      "Your situation",
      situationSummary(query),
      "high",
    ),
  );

  if (resolution) {
    const specific =
      classification.specificIssue ??
      intent?.specificIssue ??
      (classification.subArea === "housing" ? inferHousingSubIssue(query) : null);

    let issueText: string;
    if (classification.subArea === "housing" || resolution.taxonomySlug === "housing") {
      issueText = specific
        ? `This is a Landlord and Tenant issue — specifically a ${specific}.`
        : "This is a Landlord and Tenant issue (private renting, deposits, eviction, or repairs).";
    } else if (classification.subArea === "employment" || resolution.taxonomySlug === "employment") {
      issueText = specific
        ? `This looks like an Employment Law issue — specifically ${specific}.`
        : "This looks like an Employment Law issue (pay, dismissal, discrimination, or workplace disputes).";
    } else if (specific) {
      issueText = `This looks like a ${resolution.canonicalName} issue — specifically ${specific}.`;
    } else {
      const related = resolution.relatedPracticeAreas
        .filter((a) => !/community care|public law/i.test(a))
        .slice(0, 3)
        .join(", ");
      issueText = related
        ? `This looks like a ${resolution.canonicalName} issue (${related}).`
        : `This looks like a ${resolution.canonicalName} issue.`;
    }
    criteria.push(criterion("legal_issue", "Legal issue", issueText, "high"));

    if (includeDirectory) {
      criteria.push(
        criterion(
          "legal_issue",
          "Practice area (directory)",
          `Find a lawyer results are filtered and labelled for ${resolution.canonicalName}.`,
        ),
      );
    }
  } else {
    criteria.push(
      criterion(
        "legal_issue",
        "Legal issue",
        "Issue area not yet clear — we will use your exact wording and ask a clarifying question if needed.",
      ),
    );
  }

  if (matched.length) {
    criteria.push(
      criterion(
        "legal_issue",
        "Matched topics",
        `Your query mentions: ${matched.join("; ")}.`,
      ),
    );
  }

  criteria.push(
    criterion("jurisdiction", "Jurisdiction", `UK legal information for ${jurisdiction}.`),
  );

  if (input.location?.trim()) {
    criteria.push(
      criterion(
        "location",
        "Location",
        `Directory and signposting filtered toward ${input.location.trim()}.`,
      ),
    );
  }

  if (classification.urgency !== "low") {
    const urgencyLabel =
      classification.urgency === "emergency"
        ? "Emergency — prioritise immediate safety signposting and urgent help routes."
        : classification.urgency === "high"
          ? "High urgency — prioritise time-sensitive guidance and fast-access help."
          : "Medium urgency — include deadline and next-step guidance where available.";
    criteria.push(criterion("urgency", "Urgency", urgencyLabel, "high"));
  }

  criteria.push(criterion("help_route", "Help route", helpRouteText(funding, classification, includeDirectory)));

  if (resolution?.legalAidLikely) {
    criteria.push(
      criterion(
        "help_route",
        "Legal aid signal",
        "This type of issue may qualify for legal aid — directory results will favour eligible providers.",
      ),
    );
  }

  criteria.push(criterion("sources", "Sources", sourcePreferenceText()));

  criteria.push(criterion("retrieval", "Retrieval", retrievalText(expanded, includeDirectory, intent)));

  return criteria;
}
