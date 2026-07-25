# Guidance self-audit (Ask the Shaman / OpenRouter)

Daily and on-demand checks that OpenRouter synthesis stays wired for Ask the Shaman.

## Vercel production env (required for synthesis)

Set these on the `legal-shaman` Vercel project (Production):

| Variable | Value |
|----------|--------|
| `LLM_API_KEY` | OpenRouter key (`sk-or-...`) |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` |
| `ENABLE_LLM_ANSWER` | `true` |
| `LLM_SMALL_MODEL` | `openai/gpt-4o-mini` (fast; avoids serverless timeouts) |
| `LLM_TIMEOUT_MS` | `12000` (optional; default 12s) |
| `KNOWLEDGE_GRAPH_MODE` | `primary` |

Do **not** point `LLM_BASE_URL` at home Ollama or a trycloudflare tunnel from Vercel.

Without `ENABLE_LLM_ANSWER=true`, production skips OpenRouter and serves graph/excerpts only.

## Commands

```bash
cd web
npm run guidance:self-audit          # exit 1 on critical failure
npm run guidance:self-audit -- --skip-canary
npm run prod:health                  # includes LLM ping + ENABLE_LLM_ANSWER on Vercel
npm run search:audit-env:vercel
```

Daily jobs run `guidance:self-audit` after `prod:health`. Ops dashboard shows last audit + 24h `answerMode` mix. `GET /api/search/status` exposes `llmConfigured`, `llmAnswerEnabled`, `llmReachable` (cached ~5 min).
