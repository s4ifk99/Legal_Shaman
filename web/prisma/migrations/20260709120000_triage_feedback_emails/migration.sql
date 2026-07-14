-- Triage summary + Trustpilot AFS consent audit (one send per session)
CREATE TABLE "triage_feedback_emails" (
    "id" TEXT NOT NULL,
    "session_id" VARCHAR(128) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "review_consent" BOOLEAN NOT NULL,
    "user_id" VARCHAR(64),
    "merged_query" VARCHAR(800),
    "result_count" INTEGER,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "triage_feedback_emails_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "triage_feedback_emails_session_id_key" ON "triage_feedback_emails"("session_id");
CREATE INDEX "triage_feedback_emails_email_sent_at_idx" ON "triage_feedback_emails"("email", "sent_at");
