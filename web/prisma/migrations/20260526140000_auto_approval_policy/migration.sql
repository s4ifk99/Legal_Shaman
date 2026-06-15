-- AlterTable
ALTER TABLE "provider_enrichments" ADD COLUMN "policy_decision" VARCHAR(32),
ADD COLUMN "policy_reason" TEXT,
ADD COLUMN "audit_sample" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "provider_extracted_fields" ADD COLUMN "policy_decision" VARCHAR(32),
ADD COLUMN "policy_reason" TEXT,
ADD COLUMN "audit_sample" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "provider_enrichments_policy_decision_idx" ON "provider_enrichments"("policy_decision");

-- CreateIndex
CREATE INDEX "provider_extracted_fields_policy_decision_idx" ON "provider_extracted_fields"("policy_decision");
