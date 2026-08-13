# Coherence LLM architecture

## Principle

> **No subagent may call the frontier LLM merely to reinterpret information already present in MatterFrame.**

The LLM is the **planner**. TypeScript/MJS is the **executor**.

## Cost target

| Call | Purpose | Role |
|------|---------|------|
| **#1** | `matter_resolution` | MatterFrame + researchPlan + decision + helpIntent |
| **#2** | `final_synthesis` | Overview answer from verified evidence |

Hard exceptions (rare, 3rd call max):

- `blocking_ambiguity_replan`
- `blocking_ambiguity_after_retrieval`
- `evidence_research_exception`
- `evidence_replan`

Budget policy:

```text
normalMax = 2        (typical submission)
exceptionalMax = 3   (justified replan)
>3 = defect
```

Env: `COHERENCE_LLM_MAX_CALLS=2`, `COHERENCE_LLM_EXCEPTIONAL_MAX=3`, `COHERENCE_LLM_BUDGET_HARD=1` (CI/tests only).

## Target flow

```text
SUBMISSION
    │
    ▼
OPENROUTER #1  matter_resolution
    │          → MatterFrame, ResearchPlan, RequiredPropositions, Decision, HelpIntent
    ▼
MatterEngine.resolve (deterministic enrichment)
    ▼
deterministic: wiki / chunks / SRA / HelpMatch
    ▼
Evidence Gate (rules — requiredPropositions coverage)
    ▼
OPENROUTER #2  final_synthesis → Overview
```

## matter_resolution contract

```json
{
  "decision": { "canProceed": true, "needsClarification": false },
  "confidence": { "matter": 0.91, "researchPlan": 0.86 },
  "matterFrame": { "primaryIssues": [], "events": [], "ambiguities": [] },
  "researchPlan": {
    "retrievalScopes": [],
    "queries": [],
    "requiredPropositions": [
      { "id": "P1", "issue": "consumer_vehicle_repair", "question": "...", "priority": "blocking" }
    ]
  },
  "helpIntent": { "practiceAreas": [], "freeHelpTypes": [] }
}
```

`requiredPropositions` drive the deterministic Evidence Gate — not search queries.

## Feature flags

| Env | Default | Effect |
|-----|---------|--------|
| `COHERENCE_MATTER_RESOLUTION` | on (`≠0`) | Single #1 call; skips legacy Brief/Taxonomy/Ask/Answer LLM |
| `COHERENCE_LEGACY_SHADOW` | off | Heuristic legacy comparison metrics (no extra LLM) |
| `COHERENCE_LEGACY_SHADOW_LLM` | off | Full legacy LLM shadow (dev/eval only) |

Shadow metrics: primary issue agreement, relationship agreement, ambiguity agreement, event agreement, retrieval-scope agreement.

## What lost its own LLM call

| Component | Status |
|-----------|--------|
| Brief | Folded into `matter_resolution` |
| Taxonomy | Folded into `matter_resolution` |
| Timeline | Folded into `matter_resolution` |
| Ask | From `decision.needsClarification` + blocking ambiguities |
| Answer (mjs) | Pack-only on resolution path; Overview is synthesis |
| HelpMatch / SRA | Deterministic |
| Overview | `final_synthesis` |

Legacy agents remain in codebase behind shadow flag for parity measurement — they do not affect production output.

## Telemetry

Master API `llmTrace`:

```text
[coherence-cost]
frontierCalls: 2 (normal≤2, exceptional≤3, soft)
frontierTokens: ~6421+1106
frontierCost: ~$0.0016
retries: 0

By purpose:
  matter_resolution              1
  final_synthesis                1
```

Operational targets:

```text
median frontier calls/query ≤ 2
p95 frontier calls/query ≤ 3
legacy reinterpretation calls = 0
```

## Security (production)

Enable before public launch:

```text
REQUIRE_COHERENCE_AUTH=true
NEXT_PUBLIC_REQUIRE_COHERENCE_AUTH=true
```

Flow: signed-in session → verified email → IP rate limit → per-user quota → LLM budget.

Quota defaults: 10 searches/day (new account), 20/day (free), 3/minute, 1 concurrent request/user.

Cloudflare Turnstile on signup/login (already wired). Optional `captchaToken` on master POST for suspicious retries.

Usage persisted in `usage_events` (accounts DB) and tied to `llmTrace` on completion.

## Migration order

1. **Done:** centralise + purpose + budget + llmTrace  
2. **Done:** single `matter_resolution` call + skip legacy LLM on resolution path  
3. Deterministic Evidence Gate from `requiredPropositions`  
4. Wire chunks into matter-scoped Overview  
5. Remove duplicate HelpMatch path once eval gate met  
6. Enable hard budget in CI once corpus consistently ≤2 calls  
