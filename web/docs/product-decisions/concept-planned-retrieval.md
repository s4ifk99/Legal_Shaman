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

## Clusters (shipped)

Employment: `disability_absence_adjustments`, `pregnancy_maternity_redundancy`,
`workplace_harassment_bullying`, `employment_unfair_dismissal`, `employment_wages_hours`

Housing / property: `neighbour_access`, `own_property_use`, `landlord_disrepair`,
`landlord_eviction_section21`, `tenancy_deposit`, `conveyancing_misrepresentation`

Consumer / vehicles: `used_car_reject`, `garage_vehicle_repair`, `private_parking_pcn`,
`consumer_faulty_goods`, `consumer_services_trader`, `family_belongings_claim`

Immigration / family / debt / crime: `visa_refusal_challenge`, `family_visa_apply`,
`family_children_arrangements`, `family_divorce_finances`, `debt_bailiff_enforcement`,
`motoring_disqualification`

## Rule

**Add a concept cluster (or rely on raw keyphrases). Do not add a new sense detector + frame for every matter shape.**

Use `rejectIf` for bleed guards (e.g. wash-car driveway ≠ neighbour). Bleed locks in sense/packs may stay for UI; retrieval specificity lives here.
