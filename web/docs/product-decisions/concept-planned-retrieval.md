# Concept-planned wiki navigation

## Problem

Coarse domain routing (`employment`) plus one hard-coded retrieval intent
(`unfair dismissal…`) causes systematic topic drift. Hand-authored
`looksX` + frame pairs per shape do not scale.

## Breadth model (important)

| Layer | Role |
|-------|------|
| **Legal Shaman wiki** (~2.3k Area pages) | Full compiled breadth of the product’s law |
| **Taxonomy slugs** (~67) | Coarse issue routing when no cluster matches |
| **Concept clusters** (~60) | Retrieval **leaves** — multi-intent + bleed guards for known shapes |
| **Keyphrases** | Catch novel wording when no cluster fires |

Clusters are **not** “the whole of UK law.” They are navigation rules over the wiki.
Niche commercial/directory topics stay on keyphrases + slug defaults.

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

## Clusters by Area (aligned to wiki / signpost)

- **Employment** — disability/Bradford RA, pregnancy+redundancy, harassment, unfair dismissal, wages/hours, settlement agreements  
- **Housing / neighbours** — access, own driveway, disrepair, s21, deposit, conveyancing misrep, homelessness, joint tenancy, mortgage possession, council/social, noise/ASB  
- **Consumer** — used car, garage, PCN, goods, traders, belongings claim, travel, online/distance, credit, insurance, energy/telecoms  
- **Family / wills** — children, divorce finances, domestic abuse, care proceedings, wills, probate, inheritance dispute, LPA, trusts  
- **Immigration** — family visa apply, refusal, asylum, citizenship  
- **Money** — bailiffs/CCJ, IVA/bankruptcy, council tax, benefits appeals  
- **Health** — personal injury, clinical negligence  
- **Crime** — arrest/custody, police seizure, fraud victim  
- **Rights / courts / education / care** — equality goods/services, JR, school exclusion/EHCP, small claims, LiP hearing, community care, MHA detention  
- **Business** — contract dispute, insolvency/closure  
- **Driving** — totting/disqualification, drink/drug driving  

## Rule

**Add a cluster when the leaf is in the wiki/taxonomy AND coarse slug intents pull the wrong titles.**  
Otherwise expand keyphrases or rely on taxonomy slug defaults — do not invent one cluster per statute.
