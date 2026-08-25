# Coherence turn state (SaLSA / MAP-Law)

Engineering note: how we adopt research on multi-turn legal consultation without rewriting the intake stack overnight.

## Problem

Intake and Overview still fail in three research-documented ways:

1. **Topic shift / keyword bleed** — “car port” retrieves used-car CRA ([LexRAG](https://arxiv.org/abs/2502.20640), [CARE](https://openreview.net/pdf/c4ac7dc7b1ab6b236db116139b6745166f91bd2f.pdf)).
2. **History pollution** — jurisdiction chips and brief goals get cited as the client story ([LexRAG](https://arxiv.org/abs/2502.20640)).
3. **Wrong control action** — we keep retrieving or asking landlord questions when the right move is clarify / stop / pack-scoped retrieve ([MAP-Law](https://arxiv.org/abs/2605.01486), [SaLSA-RAG](https://openreview.net/pdf/f6308d9fac13f66c140484b32d2e3fbaba8b4167.pdf)).

## What we already have

| Piece | Role |
| --- | --- |
| `topicLock.ts` | Intent gate: locked `topicId` / pack + forbidden packs |
| `cite()` / narrative seeding | Prefer client story over meta chips |
| `oslawPreflight` | Corrective override when pack conflicts with lock |
| `test:coherence-traps` | Regression suite for known bleeds |

That is CARE + Corrective RAG + a thin topic lock. It is **not** yet a turn-level legal state.

## Target model (from papers)

### SaLSA-style turn state

Maintain a compact **legal analysis state** updated each turn:

- `packId` / `topicId` (locked)
- **Facts covered** (what the client already said)
- **Legal elements** still open (access right? planning? evidence? goal?)
- **Next action**: `clarify` | `retrieve_scoped` | `reformulate` | `stop_overview`

Retrieval and questions must read this state — not the raw token soup.

### MAP-Law coverage controller

Before Overview:

1. Score coverage of required elements for the locked pack.
2. If coverage low → **clarify** (one targeted gap), not dump CRA.
3. If coverage enough → **retrieve_scoped** to pack domains only.
4. If retrieval conflicts with lock → **reject / retry** (Corrective RAG).
5. If client only wanted signposting and coverage is enough → **stop_overview**.

## Pack element maps (v1)

### `neighbour-access-dispute`

| Element | Covered when |
| --- | --- |
| `counterparty_neighbour` | neighbour / neighbor in story or party |
| `access_harm` | driveway / carport / parking / blocking / access |
| `jurisdiction` | EW / Scotland / NI or locationHint |
| `evidence` | photos / messages / documents / gap_evidence answered |
| `goal` | goal set or gap_goal answered |

Forbidden packs: `car-reject-failed-repair`, `private-parking-charge`.

### `car-reject-failed-repair`

| Element | Covered when |
| --- | --- |
| `purchase` | bought / dealer / used car |
| `fault` | broke / faulty / fault codes |
| `remedy_sought` | reject / refund / repair |

Forbidden: neighbour / private-parking packs.

### `private-parking-charge`

| Element | Covered when |
| --- | --- |
| `notice_type` | PCN / parking charge / private car park |
| `issuer_hint` | council vs private if known |

## Control policy

```
lock = resolveTopicLock(session, frames)
state = deriveTurnState(session, frames, lock)

if state.nextAction == clarify:
  ask only the highest-priority missing element for lock.packId
elif state.nextAction == retrieve_scoped:
  Overview / wiki search restricted to pack domains + exclusions
elif state.nextAction == reformulate:
  ask client to restate the problem in one sentence (rare)
elif state.nextAction == stop_overview:
  buildAnswerPackage under lock; never free-associate
```

## Implementation phases

### Phase 0 (done)

Topic lock, cite hygiene, neighbour packs, trap suite.

### Phase 1 (this note + code stub)

- `turnState.ts`: `deriveTurnState`, pack element coverage, `nextAction`
- Traps asserting: locked neighbour → not `retrieve_unscoped`; multi-turn driveway + England still neighbour; used-car still CRA after clarifiers

### Phase 2 (wire)

- `nextPrompt` / causation: prefer missing elements from `deriveTurnState` over generic housing gaps when locked
- Overview API: require `topicId`; reject packs in `forbiddenPackIds`
- Master brief: never write goals into cite candidates

### Phase 3 (eval)

- Expand traps toward LexRAG / LeCoDe shapes (5-turn scripts with topic shift mid-dialogue)
- Optional: offline score vs MAP-Law coverage heuristics

## Non-goals

- Full SaLSA neural state encoder
- Training a Self-RAG model
- Replacing MatterEngine in one PR

## References

- LexRAG — https://arxiv.org/abs/2502.20640  
- MAP-Law — https://arxiv.org/abs/2605.01486  
- SaLSA-RAG — OpenReview PDF (state-aligned multi-turn legal RAG)  
- CARE — intent-gated retrieval  
- Corrective RAG — https://arxiv.org/abs/2401.15884  
- Self-RAG — https://arxiv.org/abs/2310.11511  
- Sargeant UK taxonomy — https://arxiv.org/abs/2405.12910  
