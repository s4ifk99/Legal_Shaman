-- Geocoding cache + geo columns for map search

CREATE TABLE IF NOT EXISTS "geocoded_locations" (
    "id" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "normalized_input" TEXT NOT NULL,
    "address" TEXT,
    "postcode" VARCHAR(32),
    "city" VARCHAR(255),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "provider" VARCHAR(32) NOT NULL,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "geocoded_locations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "geocoded_locations_normalized_input_key" ON "geocoded_locations"("normalized_input");
CREATE INDEX IF NOT EXISTS "geocoded_locations_postcode_idx" ON "geocoded_locations"("postcode");

ALTER TABLE "firms" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "firms" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
ALTER TABLE "firms" ADD COLUMN IF NOT EXISTS "normalized_address" TEXT;
ALTER TABLE "firms" ADD COLUMN IF NOT EXISTS "normalized_postcode" VARCHAR(32);
ALTER TABLE "firms" ADD COLUMN IF NOT EXISTS "normalized_city" VARCHAR(255);
ALTER TABLE "firms" ADD COLUMN IF NOT EXISTS "geocoding_confidence" DOUBLE PRECISION;

ALTER TABLE "sra_organisations" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "sra_organisations" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
ALTER TABLE "sra_organisations" ADD COLUMN IF NOT EXISTS "normalized_address" TEXT;
ALTER TABLE "sra_organisations" ADD COLUMN IF NOT EXISTS "normalized_postcode" VARCHAR(32);
ALTER TABLE "sra_organisations" ADD COLUMN IF NOT EXISTS "normalized_city" VARCHAR(255);
ALTER TABLE "sra_organisations" ADD COLUMN IF NOT EXISTS "geocoding_confidence" DOUBLE PRECISION;

ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "geocoding_confidence" DOUBLE PRECISION;

ALTER TABLE "search_interactions" ADD COLUMN IF NOT EXISTS "map_used" BOOLEAN;
ALTER TABLE "search_interactions" ADD COLUMN IF NOT EXISTS "map_bounds" JSONB;
ALTER TABLE "search_interactions" ADD COLUMN IF NOT EXISTS "radius_miles" DOUBLE PRECISION;
ALTER TABLE "search_interactions" ADD COLUMN IF NOT EXISTS "typesense_queries" JSONB;
