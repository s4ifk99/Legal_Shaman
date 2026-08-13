# Coherence V1 → V2 staged cutover

V1 remains the live production shell. Coherence V2 is introduced behind configuration — not a big-bang replace.

**Instant rollback:** set `COHERENCE_MODE=legacy` on Vercel and redeploy (or remove `ENABLE_COHERENCE_V2`). Classic Ask-the-Shaman behaviour returns immediately.

## Architecture

```text
Browser → Vercel POST /api/coherence/query
              │ authenticate, quota, requestId
              ▼
         Cloudflare Tunnel (server-to-server)
              ▼
    Local POST /api/internal/coherence/query
              ▼
    In-process master orchestrator (unchanged)
```

Public marketing pages stay anonymous. Auth is required only when a user runs Legal Shaman analysis (when `REQUIRE_COHERENCE_AUTH=true`).

## Modes (`COHERENCE_MODE`)

| Mode | User-facing | Execution |
|------|-------------|-----------|
| `legacy` | Classic Ask-the-Shaman (wiki + directory search) | No V2 gateway |
| `shadow` | Coherence UI for admin/sample only | Local: legacy master answers; background V2 for comparison. Vercel: same as `v2` for eligible users |
| `v2` | Coherence UI for rollout cohort | Gateway → tunnel → local backend |

Shadow mode never runs full V2 for all traffic — sampling is capped (`COHERENCE_V2_PERCENT`, max 10% in shadow) to avoid doubling OpenRouter spend.

## Phased rollout

### Phase 1 — Admin only

Vercel env:

```env
ENABLE_COHERENCE_V2=true
COHERENCE_MODE=v2
COHERENCE_V2_ADMIN_ONLY=true
NEXT_PUBLIC_COHERENCE_QUERY_GATEWAY=true
COHERENCE_BACKEND_ORIGIN=https://your-tunnel.trycloudflare.com
COHERENCE_INTERNAL_SECRET=<shared-secret>
COHERENCE_ADMIN_EMAILS=you@example.com
```

Local home server:

```env
ENABLE_COHERENCE_ASK=1
COHERENCE_INTERNAL_SECRET=<same-shared-secret>
```

Start tunnel pointing at local Next.js (port 3000):

```bash
cd Signpost/infra/home
cloudflared tunnel --config cloudflared-quick-empty.yml --url http://127.0.0.1:3000
```

### Phase 2 — Percentage rollout

```env
COHERENCE_V2_ADMIN_ONLY=false
COHERENCE_V2_PERCENT=10
REQUIRE_COHERENCE_AUTH=true
NEXT_PUBLIC_REQUIRE_COHERENCE_AUTH=true
```

### Phase 3 — All authenticated users

```env
COHERENCE_V2_PERCENT=100
```

### Phase 4 — Remove legacy

Only after production smoke tests and MatterFrame eval pass. Set classic escape hatch `?classic=1` remains until legacy code is deleted.

## Local adapter testing (before Vercel)

Test the gateway on the same machine without a tunnel:

```env
ENABLE_COHERENCE_ASK=1
COHERENCE_MODE=v2
COHERENCE_BACKEND_ORIGIN=http://127.0.0.1:3000
COHERENCE_INTERNAL_SECRET=dev-secret
NEXT_PUBLIC_COHERENCE_QUERY_GATEWAY=true
```

Run `npm run dev` and open `/ask-the-shaman`.

## Graceful failure

If the home backend is down, `POST /api/coherence/query` returns **503** with:

> Legal Shaman analysis is temporarily unavailable. Your submission has been saved. Please try again shortly.

Quota is **not** charged when the backend never starts processing.

## Idempotency

Send `x-request-id` and/or `x-idempotency-key`. Duplicate completed keys return **409** `duplicate_request`.

## Database split

| Vercel (Neon accounts DB) | Local home |
|---------------------------|------------|
| users, auth, quotas | SRA data, wiki index, retrieval |
| `UsageEvent` request records | operational research data |

Linked by `userId` + `requestId` in gateway headers.

## Files (minimum adapter surface)

| File | Role |
|------|------|
| `lib/coherence/mode.ts` | Mode + UI rollout resolution |
| `lib/coherence/server/gateway.ts` | Vercel → tunnel proxy |
| `lib/coherence/server/internal-auth.ts` | Shared secret |
| `app/api/coherence/query/route.ts` | Public gateway |
| `app/api/internal/coherence/query/route.ts` | Trusted local entry |
| `app/api/internal/health/route.ts` | Tunnel health probe |
| `app/ask-the-shaman/page.tsx` | Legacy vs Coherence shell |
| `lib/coherence/masterAgent.ts` | Client calls gateway when flagged |

## Rollback checklist

1. Vercel: `COHERENCE_MODE=legacy` (or unset `ENABLE_COHERENCE_V2`)
2. Redeploy production
3. Confirm `/ask-the-shaman` shows classic Ask-the-Shaman
4. No tunnel or home PC required for public users
