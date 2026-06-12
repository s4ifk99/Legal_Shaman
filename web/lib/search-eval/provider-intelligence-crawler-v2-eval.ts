import {
  V2_AUTO_APPROVE_THRESHOLD,
  computeV2Confidence,
  qualifiesV2AutoApprove,
} from "@/lib/provider-intelligence-crawler-v2/confidence";
import { resolveV2Approval } from "@/lib/provider-intelligence-crawler-v2/auto-approve";
import {
  buildApproveWebsitesDryRunSummary,
  classifyWebsiteRow,
} from "@/lib/provider-intelligence-crawler-v2/approve-websites";
import { resolveWebsiteForPracticeExtraction } from "@/lib/provider-intelligence-crawler-v2/website-resolution";
import {
  isRegulatoryOrDirectoryUrl,
  REGULATORY_REJECT_REASON,
} from "@/lib/provider-enrichment/regulatory-url-filter";
import { discoverFromSraRegister } from "@/lib/provider-osint/website-discovery";
import type { EnrichmentCandidate } from "@/lib/provider-enrichment/types";
import type { LegalEntityDocument } from "@/lib/search-index/types";

export async function runProviderIntelligenceCrawlerV2Eval(): Promise<number> {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL crawler-v2: ${msg}`);
    failed++;
  };

  if (V2_AUTO_APPROVE_THRESHOLD !== 0.95) {
    fail(`expected threshold 0.95, got ${V2_AUTO_APPROVE_THRESHOLD}`);
  }

  const highPhone = computeV2Confidence({
    sourceType: "sra_register",
    rawConfidence: 0.96,
    structuredField: true,
  });
  if (!qualifiesV2AutoApprove("phone", highPhone)) {
    fail(`SRA phone should auto-approve at ${highPhone}`);
  }

  const lowPhone = computeV2Confidence({
    sourceType: "provider_website",
    rawConfidence: 0.6,
  });
  if (qualifiesV2AutoApprove("phone", lowPhone)) {
    fail("low-confidence phone must not auto-approve");
  }

  if (qualifiesV2AutoApprove("practiceAreaSlugs", 0.99)) {
    fail("practice areas must not use contact auto-approve rule");
  }

  const candidate: EnrichmentCandidate = {
    entityId: "sra:1",
    entityType: "sra_organisation",
    fieldName: "phone",
    extractedValue: "+442071234567",
    sourceType: "sra_register",
    extractionMethod: "structured_field",
    confidence: 0.96,
    sourceUrl: "https://www.sra.org.uk/consumers/solicitor-check/?searchText=1",
  };

  const approved = resolveV2Approval(candidate, {
    sourceType: "sra_register",
    rawConfidence: 0.96,
    structuredField: true,
  });
  if (approved.status !== "auto_approved") {
    fail(`expected auto_approved phone, got ${approved.status}`);
  }

  const practice = resolveV2Approval(
    {
      ...candidate,
      fieldName: "practiceAreaSlugs",
      extractedValue: "employment",
    },
    { sourceType: "provider_website", rawConfidence: 0.92, officialPage: true },
  );
  if (practice.status !== "pending_review" && practice.status !== "audit_review") {
    fail(`practice area should queue for moderation, got ${practice.status}`);
  }

  const withApproved = resolveWebsiteForPracticeExtraction({
    enrichments: [
      {
        id: "1",
        entityId: "sra:1",
        entityType: "sra_organisation",
        fieldName: "website",
        extractedValue: "https://smithsolicitors.co.uk",
        confidence: 0.98,
        sourceType: "provider_website",
        extractionMethod: "html_parse",
        status: "approved",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    v2Websites: [],
  });
  if (!withApproved.websiteForExtraction?.includes("smithsolicitors")) {
    fail("approved enrichment website should be used for practice extraction");
  }

  const pendingOnly = resolveWebsiteForPracticeExtraction({
    enrichments: [],
    v2Websites: [
      {
        url: "https://example-law.co.uk",
        confidence: 0.96,
        status: "pending_review",
      },
    ],
  });
  if (pendingOnly.skipReason !== "no_approved_website") {
    fail("pending website without allow flag should skip practice extraction");
  }

  const pendingAllowed = resolveWebsiteForPracticeExtraction({
    enrichments: [],
    v2Websites: [
      {
        url: "https://example-law.co.uk",
        confidence: 0.96,
        status: "pending_review",
      },
    ],
    allowPendingWebsites: true,
  });
  if (!pendingAllowed.websiteForExtraction?.includes("example-law")) {
    fail("allow-pending-websites should use high-confidence pending website");
  }

  if (!isRegulatoryOrDirectoryUrl("https://www.sra.org.uk")) {
    fail("sra.org.uk must be regulatory/directory URL");
  }

  const sraOnly = await discoverFromSraRegister({
    id: "sra:2",
    entityType: "sra_organisation",
    title: "Example LLP",
    description: "",
    practiceAreas: [],
    categories: [],
    subIssues: [],
    searchText: "Example LLP London",
    expandedSearchText: "",
    source: "sra",
    legalAid: false,
    authorityScore: 0.5,
    profileCompletenessScore: 0.1,
    rawSourceId: "2",
    updatedAt: Date.now(),
    profileUrl: "https://www.sra.org.uk/consumers/solicitor-check/?searchText=2",
  } satisfies LegalEntityDocument);
  if (sraOnly !== null) {
    fail("SRA profile URL alone must not produce a website candidate");
  }

  const regulatoryClassify = classifyWebsiteRow(
    { url: "https://www.sra.org.uk", confidence: 0.99 },
    0.95,
  );
  if (regulatoryClassify.action !== "reject" || regulatoryClassify.reason !== REGULATORY_REJECT_REASON) {
    fail("approve-websites must reject regulatory URLs");
  }

  const dryRun = buildApproveWebsitesDryRunSummary(
    0,
    2,
    [
      {
        id: "e1",
        entityId: "sra:1",
        entityType: "sra_organisation",
        url: "https://www.sra.org.uk",
        confidence: 0.78,
        status: "pending_review",
        sourceType: "provider_website",
        sourceUrl: "https://www.sra.org.uk",
        extractionMethod: "html_parse",
        source: "provider_enrichments",
      },
      {
        id: "w1",
        entityId: "sra:2",
        entityType: "sra_organisation",
        url: "https://firm.example.co.uk",
        confidence: 0.96,
        status: "pending_review",
        sourceType: "provider_website",
        sourceUrl: "https://firm.example.co.uk",
        extractionMethod: "website_discovery",
        source: "provider_websites",
      },
    ],
    0.95,
  );
  if (dryRun.providerEnrichmentWebsitePending !== 2) {
    fail("dry-run summary must report enrichment pending count");
  }
  if (dryRun.rejectedRegulatory !== 1 || dryRun.eligible !== 1) {
    fail(`dry-run summary counts wrong: ${JSON.stringify(dryRun)}`);
  }
  if (dryRun.first10.length !== 2) {
    fail("dry-run summary must include first10 rows");
  }

  const regulatoryPractice = resolveWebsiteForPracticeExtraction({
    enrichments: [
      {
        id: "bad",
        entityId: "sra:1",
        entityType: "sra_organisation",
        fieldName: "website",
        extractedValue: "https://www.sra.org.uk",
        confidence: 0.99,
        sourceType: "sra_register",
        extractionMethod: "html_parse",
        status: "approved",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    v2Websites: [],
  });
  if (regulatoryPractice.websiteForExtraction) {
    fail("practice-area extraction must not use approved regulatory website");
  }

  if (failed === 0) {
    console.info("PASS provider intelligence crawler v2 eval (confidence, auto-approve)");
  }
  return failed;
}
