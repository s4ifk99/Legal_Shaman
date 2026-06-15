-- Crawl v2 review: status-only GROUP BY and pending sample queries
CREATE INDEX "provider_websites_status_idx" ON "provider_websites"("status");
CREATE INDEX "provider_websites_status_confidence_idx" ON "provider_websites"("status", "confidence");

CREATE INDEX "provider_contacts_status_idx" ON "provider_contacts"("status");
CREATE INDEX "provider_contacts_status_confidence_idx" ON "provider_contacts"("status", "confidence");

CREATE INDEX "provider_practice_areas_status_idx" ON "provider_practice_areas"("status");

CREATE INDEX "provider_review_signals_status_idx" ON "provider_review_signals"("status");

CREATE INDEX "provider_enrichments_field_name_status_idx" ON "provider_enrichments"("field_name", "status");
CREATE INDEX "provider_enrichments_status_confidence_idx" ON "provider_enrichments"("status", "confidence");
