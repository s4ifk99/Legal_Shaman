import {
  evaluateAutoApprovalPolicy,
  type AutoApprovalPolicyContext,
} from "@/lib/provider-enrichment/auto-approval-policy";
import { shouldAuditSample } from "@/lib/provider-enrichment/audit-sampling";

function ctx(
  over: Partial<AutoApprovalPolicyContext> & {
    field: AutoApprovalPolicyContext["field"];
  },
): AutoApprovalPolicyContext {
  return {
    entityId: over.entityId ?? "firm:test",
    entityType: over.entityType ?? "firm",
    field: over.field,
    existingApproved: over.existingApproved,
    officialWebsiteUrl: over.officialWebsiteUrl,
  };
}

export function runProviderAutoApprovalEval(): { failed: number } {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL provider-auto-approval: ${msg}`);
    failed++;
  };

  const govUkPractice = evaluateAutoApprovalPolicy(
    ctx({
      field: {
        fieldName: "practiceAreaSlugs",
        extractedValue: "employment|housing",
        sourceType: "govuk_legal_aid",
        sourceUrl: "https://www.gov.uk/legal-aid/search",
        extractionMethod: "structured_field",
        confidence: 0.92,
      },
    }),
  );
  if (govUkPractice.decision !== "auto_approve") {
    fail(`GOV.UK practice area expected auto_approve got ${govUkPractice.decision}`);
  }

  const officialPhone = evaluateAutoApprovalPolicy(
    ctx({
      officialWebsiteUrl: "https://smithsolicitors.co.uk",
      field: {
        fieldName: "phone",
        extractedValue: "+442079460958",
        sourceType: "provider_website",
        sourceUrl: "https://smithsolicitors.co.uk/contact",
        extractionMethod: "libphonenumber",
        confidence: 0.92,
      },
    }),
  );
  if (officialPhone.decision !== "auto_approve" && officialPhone.decision !== "sample_review") {
    fail(`official-domain phone expected auto_approve/sample got ${officialPhone.decision}`);
  }

  const officialEmail = evaluateAutoApprovalPolicy(
    ctx({
      officialWebsiteUrl: "https://smithsolicitors.co.uk",
      field: {
        fieldName: "email",
        extractedValue: "contact@smithsolicitors.co.uk",
        sourceType: "provider_website",
        sourceUrl: "https://smithsolicitors.co.uk/contact",
        extractionMethod: "regex",
        confidence: 0.91,
      },
    }),
  );
  if (officialEmail.decision !== "auto_approve" && officialEmail.decision !== "sample_review") {
    fail(`same-domain email expected auto_approve/sample got ${officialEmail.decision}`);
  }

  const conflictingPhone = evaluateAutoApprovalPolicy(
    ctx({
      officialWebsiteUrl: "https://smithsolicitors.co.uk",
      existingApproved: [{ fieldName: "phone", extractedValue: "+441234567890" }],
      field: {
        fieldName: "phone",
        extractedValue: "+442079460958",
        sourceType: "provider_website",
        sourceUrl: "https://smithsolicitors.co.uk/contact",
        extractionMethod: "libphonenumber",
        confidence: 0.95,
      },
    }),
  );
  if (conflictingPhone.decision !== "manual_review") {
    fail(`conflicting phone expected manual_review got ${conflictingPhone.decision}`);
  }

  const trustpilot = evaluateAutoApprovalPolicy(
    ctx({
      field: {
        fieldName: "testimonial_snippet",
        extractedValue: "Great firm, highly recommend.",
        sourceType: "trustpilot_api",
        sourceUrl: "https://www.trustpilot.com/review/example",
        extractionMethod: "trustpilot_api",
        confidence: 0.99,
        reviewCategory: "testimonial",
      },
    }),
  );
  if (trustpilot.decision !== "manual_review") {
    fail(`Trustpilot testimonial expected manual_review got ${trustpilot.decision}`);
  }

  const lowWebsite = evaluateAutoApprovalPolicy(
    ctx({
      field: {
        fieldName: "website",
        extractedValue: "https://example-solicitors.co.uk",
        sourceType: "provider_website",
        sourceUrl: "https://example-solicitors.co.uk",
        extractionMethod: "html_parse",
        confidence: 0.88,
      },
    }),
  );
  if (lowWebsite.decision !== "manual_review") {
    fail(`low-confidence website expected manual_review got ${lowWebsite.decision}`);
  }

  const noSourceUrl = evaluateAutoApprovalPolicy(
    ctx({
      field: {
        fieldName: "phone",
        extractedValue: "+442079460958",
        sourceType: "provider_website",
        extractionMethod: "libphonenumber",
        confidence: 0.95,
      },
    }),
  );
  if (noSourceUrl.decision !== "reject") {
    fail(`missing sourceUrl expected reject got ${noSourceUrl.decision}`);
  }

  const prevDeterministic = process.env.AUTO_APPROVAL_DETERMINISTIC;
  const prevAutoRate = process.env.AUTO_APPROVAL_AUTO_RATE;
  process.env.AUTO_APPROVAL_DETERMINISTIC = "1";
  process.env.AUTO_APPROVAL_AUTO_RATE = "0.85";

  const sampleA = shouldAuditSample({
    entityId: "firm:audit-a",
    fieldName: "phone",
    extractedValue: "+442011111111",
    confidence: 0.82,
  });
  const sampleB = shouldAuditSample({
    entityId: "firm:audit-a",
    fieldName: "phone",
    extractedValue: "+442011111111",
    confidence: 0.82,
  });
  if (sampleA !== sampleB) {
    fail("audit sampling should be deterministic when AUTO_APPROVAL_DETERMINISTIC=1");
  }

  const mediumGov = evaluateAutoApprovalPolicy(
    ctx({
      field: {
        fieldName: "address",
        extractedValue: "10 High Street, London SW1A 1AA",
        sourceType: "govuk_legal_aid",
        sourceUrl: "https://www.gov.uk/legal-aid/search",
        extractionMethod: "structured_field",
        confidence: 0.8,
      },
    }),
  );
  if (mediumGov.decision !== "auto_approve" && mediumGov.decision !== "sample_review") {
    fail(`medium GOV.UK address expected auto_approve or sample_review got ${mediumGov.decision}`);
  }
  if (mediumGov.decision === "sample_review" && !mediumGov.auditSample) {
    fail("sample_review decision should set auditSample=true");
  }

  if (prevDeterministic === undefined) delete process.env.AUTO_APPROVAL_DETERMINISTIC;
  else process.env.AUTO_APPROVAL_DETERMINISTIC = prevDeterministic;
  if (prevAutoRate === undefined) delete process.env.AUTO_APPROVAL_AUTO_RATE;
  else process.env.AUTO_APPROVAL_AUTO_RATE = prevAutoRate;

  return { failed };
}
