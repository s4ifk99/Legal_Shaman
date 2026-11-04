-- Bookmark notes / follow-through (Exp 5)
ALTER TABLE "bookmarks" ADD COLUMN IF NOT EXISTS "note" VARCHAR(2000);
ALTER TABLE "bookmarks" ADD COLUMN IF NOT EXISTS "next_action" VARCHAR(500);
ALTER TABLE "bookmarks" ADD COLUMN IF NOT EXISTS "status" VARCHAR(32) NOT NULL DEFAULT 'not_contacted';
ALTER TABLE "bookmarks" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 99p privacy upgrade purchases (Exp 6)
CREATE TABLE IF NOT EXISTS "privacy_upgrades" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "stripe_session_id" VARCHAR(255),
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "covers_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "privacy_upgrades_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "privacy_upgrades_stripe_session_id_key" ON "privacy_upgrades"("stripe_session_id");
CREATE INDEX IF NOT EXISTS "privacy_upgrades_user_id_created_at_idx" ON "privacy_upgrades"("user_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "privacy_upgrades" ADD CONSTRAINT "privacy_upgrades_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Provider fee/capacity enquiry log (Exp 7)
CREATE TABLE IF NOT EXISTS "provider_enquiries" (
    "id" TEXT NOT NULL,
    "firm_name" VARCHAR(512) NOT NULL,
    "firm_email" VARCHAR(255),
    "area_of_law" VARCHAR(255) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'sent',
    "cost_summary" VARCHAR(1000),
    "capacity_summary" VARCHAR(1000),
    "eligibility_note" VARCHAR(1000),
    "responded_at" TIMESTAMPTZ(3),
    "notes" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "provider_enquiries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "provider_enquiries_created_at_idx" ON "provider_enquiries"("created_at");
CREATE INDEX IF NOT EXISTS "provider_enquiries_status_idx" ON "provider_enquiries"("status");
