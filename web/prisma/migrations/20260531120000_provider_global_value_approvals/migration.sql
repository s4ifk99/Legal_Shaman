-- Global value approvals for provider crawler moderation de-duplication
CREATE TABLE "provider_global_value_approvals" (
    "id" TEXT NOT NULL,
    "field_name" VARCHAR(64) NOT NULL,
    "normalized_value" TEXT NOT NULL,
    "display_value" TEXT NOT NULL,
    "approved_by" VARCHAR(128),
    "approved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_global_value_approvals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_global_value_approvals_field_name_normalized_value_key"
    ON "provider_global_value_approvals"("field_name", "normalized_value");

CREATE INDEX "provider_global_value_approvals_field_name_idx"
    ON "provider_global_value_approvals"("field_name");
