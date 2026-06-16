CREATE TABLE IF NOT EXISTS signpost_waitlist (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  firm_name TEXT,
  practice_area TEXT,
  website TEXT,
  message TEXT,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS signpost_waitlist_email_lower_key ON signpost_waitlist (lower(email));
