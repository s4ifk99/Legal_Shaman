# V3 draft 1 — local Third Eye + Case CRM

Run and demo this draft **on localhost**. No production deploy is required.

## Setup

```bash
cd "/home/pravda/Projects/Legal Shaman/Signpost-exp5/web"

# If you already have Signpost credentials:
#   ln -sf ../../Signpost/web/.env.local .env.local
# Or copy .env.example → .env.local and set DATABASE_URL / ACCOUNTS_DATABASE_URL.

npm install
npm run db:generate

# Optional: apply migrations (Case table also self-heals via ensureCaseSchema)
npm run db:migrate:accounts   # or npm run db:migrate:dev if single DB

# Enable the simplified shell explicitly (on by default in development)
echo 'NEXT_PUBLIC_V3_SIMPLE_SHELL=1' >> .env.local

npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Demo path

1. Create an account (gate before Third Eye work).
2. Type or dictate your situation.
3. Answer financing questions one at a time (legal aid from zero).
4. See your plan of action; open **Your case** (`/my-case`).

## Flags

| Variable | Effect |
|---|---|
| `NEXT_PUBLIC_V3_SIMPLE_SHELL=1` | Force simplified home + header |
| `NEXT_PUBLIC_V3_SIMPLE_SHELL=0` | Keep classic multi-card home (even in dev) |
| unset in `development` | Simplified shell **on** |
| unset in production | Simplified shell **off** |

## Disable classic clutter

With the flag on, `/` shows brand + Third Eye only. Browse the wider directory via the quiet footer link to `/search` or `/signposting`.
