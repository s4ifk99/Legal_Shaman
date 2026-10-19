-- CreateTable
CREATE TABLE "provider_notes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider_key" VARCHAR(512) NOT NULL,
    "display_name" VARCHAR(512) NOT NULL,
    "url" VARCHAR(1024),
    "status" VARCHAR(32) NOT NULL DEFAULT 'not_contacted',
    "contacted_on" VARCHAR(32),
    "contact_name" VARCHAR(255),
    "what_they_said" TEXT,
    "fees_or_eligibility" TEXT,
    "follow_up" TEXT,
    "impression" TEXT,
    "shortlisted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_notes_user_id_updated_at_idx" ON "provider_notes"("user_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "provider_notes_user_id_provider_key_key" ON "provider_notes"("user_id", "provider_key");

-- AddForeignKey
ALTER TABLE "provider_notes" ADD CONSTRAINT "provider_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
