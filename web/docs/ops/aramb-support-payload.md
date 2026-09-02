# Aramb support payload — Third Eye / Penumbra

Copy the block below into an Aramb support ticket or email. Replace placeholders in **angle brackets** with values from Vercel env (never paste API keys into tickets).

---

## Subject

`session.run()` hangs or times out from Vercel serverless — agent <AGENT_ID_SUFFIX>

---

## Environment

| Field | Value |
|---|---|
| **Product** | Legal Shaman — Third Eye (Penumbra research) |
| **SDK** | `@aramb-ai/sdk@0.0.12` |
| **Transport** | WebSocket via `session.run()` (non-streaming; we avoid stream due to prior tool-frame errors) |
| **Gateway** | `<ARAMB_BASE_URL host>` e.g. `api.aramb.ai` |
| **Agent ID** | `<ARAMB_AGENT_ID>` |
| **Deploy** | Vercel serverless, Node 22, region `<VERCEL_REGION>` e.g. `lhr1` |
| **Function timeout** | 300s (we abort client wait at 290s) |

---

## Symptom

Penumbra research calls `/api/coherence/aramb/research` → `runArambResearch()` → `session.run(prompt)`.

**Observed behaviour (2026-09-01):**

1. **Earlier (fixed on our side):** immediate failure `b.mask is not a function` — caused by webpack bundling `ws`/`bufferutil` on Vercel. Fixed with `serverExternalPackages: ["@aramb-ai/sdk", "ws", "bufferutil"]`.

2. **Current:** WebSocket connects (no `b.mask` in logs). `session.run()` does **not** return within **290s**. API returns `fallback: true` with:

   ```json
   "researchDiagnostic": {
     "reason": "timeout",
     "latencyMs": 290000,
     "timeoutMs": 290000,
     "gatewayHost": "api.aramb.ai",
     "agentIdSuffix": "<last 8 chars of agent id>",
     "sdkVersion": "0.0.12"
   }
   ```

3. Same agent intermittently completed in **~76–87s** from our dev host (Envy) earlier the same day, then began timing out / falling back without `latencyMs` or `tokens`.

---

## Minimal reproduction (server-side)

```typescript
import { Aramb } from '@aramb-ai/sdk'

const client = new Aramb({
  apiKey: process.env.ARAMB_KEY,
  baseUrl: process.env.ARAMB_BASE_URL, // e.g. https://api.aramb.ai/gw/
})

const session = client.session({
  agentId: process.env.ARAMB_AGENT_ID,
  subTenant: 'legal-shaman-support-repro',
  newConversation: true,
  ephemeral: true,
  ephemeralTtlSeconds: 300,
  ephemeralIdleTimeoutSeconds: 120,
})

const started = Date.now()
const result = await session.run(
  'Reply with JSON only: {"status":"complete","questions":[],"sources":[],"claims":[],"conflicts":[],"missingFacts":[],"nextActions":[],"freeResources":[]}',
)
console.log({ elapsedMs: Date.now() - started, replyLength: result.reply.length, tokens: result.usage?.tokens })
await session.close()
```

**Expected:** `done` frame within ~60–120s for a trivial prompt.  
**Actual:** no `done` within 290s+ (hang), or fallback with empty `conversationId`.

---

## Log query (our Vercel project)

Search production runtime logs for:

```
[aramb-pilot] {"event":"research_outcome"
```

Failure reasons we emit:

| `reason` | Meaning |
|---|---|
| `sdk_error` | SDK threw (message in `errorMessage`) |
| `parse_failed` | Agent replied but JSON bundle did not parse |
| `empty_bundle` | Parsed JSON had no sources and no questions |
| `timeout` | `session.run()` exceeded 290s |
| `disabled` | Pilot env vars off |

Success:

```
[aramb-pilot] {"event":"research_success"
```

---

## Request

Please check agent `<ARAMB_AGENT_ID>` for:

- Stuck or queued runs on WebSocket `/v1/stream`
- Tool/browser steps that never emit `done`
- Regional latency or rate limits from `lhr1` / EU to your gateway
- Any incident matching SDK `0.0.12` + ephemeral sessions

We can provide `conversationId` from a failing run if you enable correlation on your side.

---

## Safe test endpoint (our production)

```bash
curl -sS -X POST 'https://www.legalshaman.com/api/coherence/aramb/research' \
  -H 'Content-Type: application/json' \
  -d '{
    "latestText":"employment tribunal unfair dismissal preliminary hearing England Wales",
    "searchMode":"penumbra",
    "caseKey":"aramb-support-repro-001",
    "stream":false,
    "clientQuestion":"What to prepare for a preliminary hearing?"
  }'
```

Inspect `researchDiagnostic.reason` and `latencyMs` in the JSON response.
