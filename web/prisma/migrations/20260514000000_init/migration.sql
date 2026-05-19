-- Initial Legal Shaman schema.
-- Enable required extensions BEFORE table creation so the `vector` type resolves.
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =========================================================================
-- SRA organisations (ported from MySQL)
-- =========================================================================
CREATE TABLE "sra_organisations" (
    "id" VARCHAR(128) NOT NULL,
    "sra_id" VARCHAR(64) NOT NULL,
    "business_name" VARCHAR(512) NOT NULL,
    "search_text" TEXT NOT NULL,
    "city" VARCHAR(255) NOT NULL DEFAULT '',
    "postcode" VARCHAR(32) NOT NULL DEFAULT '',
    "county" VARCHAR(255) NOT NULL DEFAULT '',
    "country" VARCHAR(128) NOT NULL DEFAULT '',
    "sra_profile_url" VARCHAR(2048) NOT NULL,
    "source" VARCHAR(16) NOT NULL DEFAULT 'sra',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sra_organisations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sra_organisations_sra_id_key" ON "sra_organisations"("sra_id");

-- =========================================================================
-- Firms
-- =========================================================================
CREATE TABLE "firms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "firms_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "firms_name_idx" ON "firms"("name");

-- =========================================================================
-- Lawyers (with pgvector embedding column)
-- =========================================================================
CREATE TABLE "lawyers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "firm_id" TEXT,
    "bio" TEXT NOT NULL,
    "years_experience" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "consultation_options" TEXT[],
    "verified_credentials" BOOLEAN NOT NULL DEFAULT false,
    "profile_url" TEXT,
    "embedding" vector(1536),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lawyers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lawyers_firm_id_idx" ON "lawyers"("firm_id");
CREATE INDEX "lawyers_rating_idx" ON "lawyers"("rating");
CREATE INDEX "lawyers_verified_credentials_idx" ON "lawyers"("verified_credentials");

-- HNSW approximate-nearest-neighbour index for cosine similarity over the embedding column.
CREATE INDEX "lawyer_embedding_hnsw_idx"
  ON "lawyers" USING hnsw ("embedding" vector_cosine_ops);

-- Trigram index over bio for fast ILIKE keyword search.
CREATE INDEX "lawyer_bio_trgm_idx"
  ON "lawyers" USING gin ("bio" gin_trgm_ops);

ALTER TABLE "lawyers"
  ADD CONSTRAINT "lawyers_firm_id_fkey"
  FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =========================================================================
-- Practice areas + join
-- =========================================================================
CREATE TABLE "practice_areas" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "practice_areas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "practice_areas_slug_key" ON "practice_areas"("slug");

CREATE TABLE "lawyer_practice_areas" (
    "lawyer_id" TEXT NOT NULL,
    "practice_area_id" TEXT NOT NULL,

    CONSTRAINT "lawyer_practice_areas_pkey" PRIMARY KEY ("lawyer_id","practice_area_id")
);
CREATE INDEX "lawyer_practice_areas_practice_area_id_idx" ON "lawyer_practice_areas"("practice_area_id");

ALTER TABLE "lawyer_practice_areas"
  ADD CONSTRAINT "lawyer_practice_areas_lawyer_id_fkey"
  FOREIGN KEY ("lawyer_id") REFERENCES "lawyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lawyer_practice_areas"
  ADD CONSTRAINT "lawyer_practice_areas_practice_area_id_fkey"
  FOREIGN KEY ("practice_area_id") REFERENCES "practice_areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- Locations
-- =========================================================================
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "lawyer_id" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "postcode" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT 'United Kingdom',
    "jurisdiction" TEXT NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "locations_lawyer_id_idx" ON "locations"("lawyer_id");
CREATE INDEX "locations_city_idx" ON "locations"("city");
CREATE INDEX "locations_jurisdiction_idx" ON "locations"("jurisdiction");

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_lawyer_id_fkey"
  FOREIGN KEY ("lawyer_id") REFERENCES "lawyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- Languages + join
-- =========================================================================
CREATE TABLE "languages" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "languages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "languages_code_key" ON "languages"("code");

CREATE TABLE "lawyer_languages" (
    "lawyer_id" TEXT NOT NULL,
    "language_id" TEXT NOT NULL,

    CONSTRAINT "lawyer_languages_pkey" PRIMARY KEY ("lawyer_id","language_id")
);
CREATE INDEX "lawyer_languages_language_id_idx" ON "lawyer_languages"("language_id");

ALTER TABLE "lawyer_languages"
  ADD CONSTRAINT "lawyer_languages_lawyer_id_fkey"
  FOREIGN KEY ("lawyer_id") REFERENCES "lawyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lawyer_languages"
  ADD CONSTRAINT "lawyer_languages_language_id_fkey"
  FOREIGN KEY ("language_id") REFERENCES "languages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- Credentials
-- =========================================================================
CREATE TABLE "credentials" (
    "id" TEXT NOT NULL,
    "lawyer_id" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "registration_number" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3),

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "credentials_lawyer_id_idx" ON "credentials"("lawyer_id");

ALTER TABLE "credentials"
  ADD CONSTRAINT "credentials_lawyer_id_fkey"
  FOREIGN KEY ("lawyer_id") REFERENCES "lawyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- Reviews
-- =========================================================================
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "lawyer_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reviews_lawyer_id_idx" ON "reviews"("lawyer_id");

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_lawyer_id_fkey"
  FOREIGN KEY ("lawyer_id") REFERENCES "lawyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- Availability
-- =========================================================================
CREATE TABLE "availability" (
    "id" TEXT NOT NULL,
    "lawyer_id" TEXT NOT NULL,
    "accepting_clients" BOOLEAN NOT NULL DEFAULT true,
    "response_hours" INTEGER,
    "free_consultation" BOOLEAN NOT NULL DEFAULT false,
    "fixed_fee_consultation" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "availability_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "availability_lawyer_id_key" ON "availability"("lawyer_id");

ALTER TABLE "availability"
  ADD CONSTRAINT "availability_lawyer_id_fkey"
  FOREIGN KEY ("lawyer_id") REFERENCES "lawyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- Search interactions (agent observability)
-- =========================================================================
CREATE TABLE "search_interactions" (
    "id" TEXT NOT NULL,
    "user_session_id" TEXT,
    "raw_query" TEXT NOT NULL,
    "extracted_filters" JSONB NOT NULL,
    "clarifying_asked" BOOLEAN NOT NULL DEFAULT false,
    "result_lawyer_ids" TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_interactions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "search_interactions_user_session_id_idx" ON "search_interactions"("user_session_id");
CREATE INDEX "search_interactions_createdAt_idx" ON "search_interactions"("createdAt");
