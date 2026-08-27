# Concept-planned wiki navigation

## Problem

Coarse domain routing (`employment`) plus one hard-coded retrieval intent
(`unfair dismissal…`) causes systematic topic drift. Hand-authored
`looksX` + frame pairs per shape do not scale.

## Pattern (papers)

| Idea | Source | What we built |
|------|--------|----------------|
| Keyphrase → retrieval plan | LexKeyPlan (ACL 2025) | `extractStoryKeyphrases` + multi-intents |
| Intent taxonomy / multi-intent | Shao et al.; MuISQA; DMQR-RAG | `CONCEPT_CLUSTERS` + fused intents |
| Compile wiki, navigate at query time | Karpathy LLM Wiki; WiCER | Wiki stays the store; planner only navigates |

## Code

- `lib/matter/conceptRetrievalPlan.ts` — concepts + clusters → intents + title exclusions
- `lib/matter/retrieval-plan.ts` — concept plan first; suppress slug defaults when a cluster matches
- `lib/matter/resolve.ts` — story keyphrases compound into `MatterFrame.concepts`

## Rule

**Add a concept cluster (or rely on raw keyphrases). Do not add a new sense detector + frame for every matter shape.**

Bleed locks (`neighbour≠car`, etc.) may stay as detectors. Specificity lives in concepts.
