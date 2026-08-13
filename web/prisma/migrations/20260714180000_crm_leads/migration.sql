-- CreateTable
CREATE TABLE "crm_leads" (
    "id" TEXT NOT NULL,
    "sra_id" VARCHAR(64) NOT NULL,
    "stage" VARCHAR(16) NOT NULL DEFAULT 'cold',
    "notes" TEXT NOT NULL DEFAULT '',
    "lead_contact_name" VARCHAR(255) NOT NULL DEFAULT '',
    "lead_contact_role" VARCHAR(255) NOT NULL DEFAULT '',
    "lead_contact_email" VARCHAR(512) NOT NULL DEFAULT '',
    "lead_contact_phone" VARCHAR(64) NOT NULL DEFAULT '',
    "sales_champion_name" VARCHAR(255) NOT NULL DEFAULT '',
    "sales_champion_role" VARCHAR(255) NOT NULL DEFAULT '',
    "sales_champion_email" VARCHAR(512) NOT NULL DEFAULT '',
    "sales_champion_phone" VARCHAR(64) NOT NULL DEFAULT '',
    "sales_champion_notes" TEXT NOT NULL DEFAULT '',
    "last_contacted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_leads_sra_id_key" ON "crm_leads"("sra_id");

-- CreateIndex
CREATE INDEX "crm_leads_stage_updated_at_idx" ON "crm_leads"("stage", "updated_at");
