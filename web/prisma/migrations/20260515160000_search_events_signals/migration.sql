-- Search feedback events + aggregated ranking signals
CREATE TABLE "search_events" (
    "id" TEXT NOT NULL,
    "session_hash" VARCHAR(64) NOT NULL,
    "search_interaction_id" TEXT,
    "query_prefix" VARCHAR(120) NOT NULL,
    "parsed_practice_area" VARCHAR(64),
    "parsed_location" VARCHAR(128),
    "result_id" VARCHAR(128),
    "result_source" VARCHAR(32),
    "result_rank" INTEGER,
    "event_type" VARCHAR(48) NOT NULL,
    "page" VARCHAR(32) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "search_events_session_hash_created_at_idx" ON "search_events"("session_hash", "created_at");
CREATE INDEX "search_events_event_type_created_at_idx" ON "search_events"("event_type", "created_at");
CREATE INDEX "search_events_result_id_result_source_event_type_idx" ON "search_events"("result_id", "result_source", "event_type");

ALTER TABLE "search_events" ADD CONSTRAINT "search_events_search_interaction_id_fkey" FOREIGN KEY ("search_interaction_id") REFERENCES "search_interactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "search_ranking_signals" (
    "id" TEXT NOT NULL,
    "entity_id" VARCHAR(128) NOT NULL,
    "entity_source" VARCHAR(32) NOT NULL,
    "practice_area" VARCHAR(64) NOT NULL DEFAULT '',
    "city" VARCHAR(128) NOT NULL DEFAULT '',
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "contact_clicks" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contact_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "search_ranking_signals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "search_ranking_signals_entity_id_entity_source_practice_area_city_key" ON "search_ranking_signals"("entity_id", "entity_source", "practice_area", "city");
CREATE INDEX "search_ranking_signals_practice_area_city_idx" ON "search_ranking_signals"("practice_area", "city");
