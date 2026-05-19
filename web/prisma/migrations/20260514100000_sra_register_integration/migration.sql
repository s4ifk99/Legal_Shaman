-- SRA register integration: link Firm rows to SRA orgs + embed SRA orgs for the matcher.

-- 1) Firm gets SRA linkage + address fields.
ALTER TABLE "firms"
  ADD COLUMN "sra_id" TEXT,
  ADD COLUMN "sra_profile_url" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "postcode" TEXT,
  ADD COLUMN "country" TEXT;

CREATE UNIQUE INDEX "firms_sra_id_key" ON "firms"("sra_id");

-- 2) SRA organisations get an embedding column + indexes for matcher retrieval.
ALTER TABLE "sra_organisations" ADD COLUMN "embedding" vector(1536);

CREATE INDEX "sra_org_embedding_hnsw_idx"
  ON "sra_organisations" USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX "sra_org_business_name_trgm_idx"
  ON "sra_organisations" USING gin ("business_name" gin_trgm_ops);

CREATE INDEX "sra_org_search_text_trgm_idx"
  ON "sra_organisations" USING gin ("search_text" gin_trgm_ops);
