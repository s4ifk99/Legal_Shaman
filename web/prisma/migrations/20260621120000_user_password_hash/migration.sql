-- Add optional password hash for secure account login (legacy users may have NULL).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" VARCHAR(255);
