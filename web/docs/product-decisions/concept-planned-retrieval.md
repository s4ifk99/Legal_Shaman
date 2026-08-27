# Concept-planned wiki navigation

## Problem

Coarse domain routing (`employment`) plus one hard-coded retrieval intent
(`unfair dismissal…`) causes systematic topic drift. Hand-authored
`looksX` + frame pairs per shape do not scale.

## Breadth model

| Layer | Role |
|-------|------|
| **Legal Shaman wiki** (~2.3k Area pages) | Full compiled breadth of the product’s law |
| **Area → slug defaults** (`areaIntentDefaults.ts`) | Every wiki Area has default retrieval intents |
| **Taxonomy slugs** | Coarse issue routing when no cluster matches |
| **Concept clusters** (~61) | Retrieval leaves — multi-intent + bleed guards |
| **Matter-resolution concepts** | OpenRouter emits `concepts[]` → merged into frame → intents |
| **Story keyphrases** | Catch novel wording |

## Wiring (shipped)

1. `lib/matter/areaIntentDefaults.ts` — 15 Areas (14 wiki + Education) → slugs → intents/scopes  
2. `lib/matter/scopes.ts` — merges Area defaults into `ISSUE_RETRIEVAL_INTENTS` / `SCOPES`  
3. Master `/api/coherence/llm/master` passes agent `matterFrame.concepts` into `MatterEngine.resolve({ agentConcepts })`  
4. `buildConcepts` / `mergeTaxonomy` union agent concepts + taxonomy boosts + keyphrases  
5. `SessionMatterFrame.concepts` preserved for later Overview / answer turns  
6. `buildConceptRetrievalPlan` turns those concepts into multi-intent wiki queries  

## Pattern (papers)

| Idea | Source | What we built |
|------|--------|----------------|
| Keyphrase → retrieval plan | LexKeyPlan | story + agent concepts → intents |
| Intent taxonomy / multi-intent | Shao; MuISQA | clusters + Area slug defaults |
| Compile wiki, navigate at query time | Karpathy / WiCER | wiki store; planner navigates |

## Rule

**Add a cluster when the leaf is in the wiki/taxonomy AND coarse slug intents pull the wrong titles.**  
Otherwise expand Area defaults / rely on agent concepts — do not invent one cluster per statute.
