# Search RAG Evaluation Report

Generated: 2026-05-19T10:20:10.970Z

## Summary

| Metric | Value |
|--------|-------|
| Cases | 37 |
| Passed | 29 |
| Failed | 8 |
| Taxonomy accuracy | 87.9% |
| Clarification accuracy | 100.0% |
| No-result failure rate | 0.0% |
| Avg Precision@K | 0.692 |
| Avg Recall@K | 0.757 |
| Avg MRR | 0.742 |
| Avg NDCG-lite@K | 0.740 |
| Map marker availability | 62.7% |
| Explanation safety | 100.0% |

**Pass criteria met:** Yes

## Failing cases

### dir-brother-in-prison-01

- **Query:** my brother is in prison
- **Channel:** directory
- **Failures:** taxonomy: expected prison_law, got null; recall: 1/2 relevant in top 10
- **Taxonomy:** — (accurate: false)
- **Results:** 10 (relevant in top-K: 1)
- **Metrics:** P@10=0.10 R@10=0.50 MRR=0.11 NDCG=0.30
- **Retrieval:** engine=typesense_unified, fallback=false, degraded=none

| Rank | Relevant | Title | Source | Reasons |
|------|----------|-------|--------|---------|
| 1 | no | Organisation 855006 | sra | — |
| 2 | no | Organisation 849849 | sra | — |
| 3 | no | Organisation 219920 | sra | — |
| 4 | no | Organisation 219856 | sra | — |
| 5 | no | Organisation 218282 | sra | — |
| 6 | no | Organisation 217671 | sra | — |
| 7 | no | Organisation 213838 | sra | — |
| 8 | no | Organisation 213312 | sra | — |

### dir-lost-job-01

- **Query:** i lost my job
- **Channel:** directory
- **Failures:** taxonomy: expected employment, got null; recall: 0/2 relevant in top 10
- **Taxonomy:** — (accurate: false)
- **Results:** 10 (relevant in top-K: 0)
- **Metrics:** P@10=0.00 R@10=0.00 MRR=0.00 NDCG=0.00
- **Retrieval:** engine=typesense_unified, fallback=false, degraded=none

| Rank | Relevant | Title | Source | Reasons |
|------|----------|-------|--------|---------|
| 1 | no | I H & A Law LTD T/A Kendalls Solicitors | legal_aid | — |
| 2 | no | Organisation 219920 | sra | — |
| 3 | no | G & I Chisholm | legal_aid | — |
| 4 | no | Organisation 844928 | sra | — |
| 5 | no | M I Solicitors | legal_aid | — |
| 6 | no | Organisation 657283 | sra | — |
| 7 | no | I H & A Law LTD T/A Kendalls Solicitors | legal_aid | — |
| 8 | no | Organisation 226010 | sra | — |

### dir-child-contact-01

- **Query:** my ex won't let me see my child
- **Channel:** directory
- **Failures:** taxonomy: expected family, got null; recall: 0/2 relevant in top 10
- **Taxonomy:** — (accurate: false)
- **Results:** 10 (relevant in top-K: 0)
- **Metrics:** P@10=0.00 R@10=0.00 MRR=0.00 NDCG=0.00
- **Retrieval:** engine=typesense_unified, fallback=false, degraded=none

| Rank | Relevant | Title | Source | Reasons |
|------|----------|-------|--------|---------|
| 1 | no | Organisation 855006 | sra | — |
| 2 | no | Organisation 849849 | sra | — |
| 3 | no | Organisation 219920 | sra | — |
| 4 | no | Organisation 219856 | sra | — |
| 5 | no | Organisation 218282 | sra | — |
| 6 | no | Organisation 217671 | sra | — |
| 7 | no | Organisation 213838 | sra | — |
| 8 | no | Organisation 213312 | sra | — |

### dir-no-will-01

- **Query:** dad died without a will
- **Channel:** directory
- **Failures:** taxonomy: expected wills_probate, got null; recall: 1/2 relevant in top 10
- **Taxonomy:** — (accurate: false)
- **Results:** 1 (relevant in top-K: 1)
- **Metrics:** P@1=1.00 R@1=0.50 MRR=1.00 NDCG=1.00
- **Retrieval:** engine=typesense_unified, fallback=false, degraded=none

| Rank | Relevant | Title | Source | Reasons |
|------|----------|-------|--------|---------|
| 1 | yes | Organisation 223539 | sra | term:will |

### dir-doctor-mistake-01

- **Query:** doctor made a mistake
- **Channel:** directory
- **Failures:** taxonomy: expected clinical_negligence, got null; recall: 0/2 relevant in top 10
- **Taxonomy:** — (accurate: false)
- **Results:** 1 (relevant in top-K: 0)
- **Metrics:** P@1=0.00 R@1=0.00 MRR=0.00 NDCG=0.00
- **Retrieval:** engine=typesense_unified, fallback=false, degraded=none

| Rank | Relevant | Title | Source | Reasons |
|------|----------|-------|--------|---------|
| 1 | no | Organisation 595980 | sra | — |

### dir-car-accident-01

- **Query:** injured in a car accident
- **Channel:** directory
- **Failures:** taxonomy: expected personal_injury, got null
- **Taxonomy:** — (accurate: false)
- **Results:** 3 (relevant in top-K: 3)
- **Metrics:** P@3=1.00 R@3=1.00 MRR=1.00 NDCG=1.00
- **Retrieval:** engine=typesense_unified, fallback=false, degraded=none

| Rank | Relevant | Title | Source | Reasons |
|------|----------|-------|--------|---------|
| 1 | yes | Slater and Gordon | curated_listing | taxonomy:personal_injury, term:injury |
| 2 | yes | Irwin Mitchell | curated_listing | taxonomy:personal_injury, term:injury |
| 3 | yes | Leigh Day | curated_listing | taxonomy:personal_injury, term:injury |

### dir-school-exclusion-01

- **Query:** child excluded from school appeal
- **Channel:** directory
- **Failures:** taxonomy: expected education, got prison_law; recall: 0/1 relevant in top 10
- **Taxonomy:** prison_law (accurate: false)
- **Results:** 10 (relevant in top-K: 0)
- **Metrics:** P@10=0.00 R@10=0.00 MRR=0.00 NDCG=0.00
- **Retrieval:** engine=typesense_unified, fallback=false, degraded=none

| Rank | Relevant | Title | Source | Reasons |
|------|----------|-------|--------|---------|
| 1 | no | Reunite International Child Abduction Centre | legal_aid | — |
| 2 | no | Family Rights Group | curated_listing | — |
| 3 | no | Catriona MacLeod | lawyer | — |
| 4 | no | Organisation 744111 | sra | — |
| 5 | no | Thursfields Child Care LLP | legal_aid | — |
| 6 | no | Daniel Hughes | lawyer | — |
| 7 | no | Organisation 570439 | sra | — |
| 8 | no | Family & Child Law Solicitors | legal_aid | — |

### dir-business-contract-01

- **Query:** breach of business contract
- **Channel:** directory
- **Failures:** taxonomy: expected commercial, got null
- **Taxonomy:** — (accurate: false)
- **Results:** 6 (relevant in top-K: 6)
- **Metrics:** P@6=1.00 R@6=1.00 MRR=1.00 NDCG=1.00
- **Retrieval:** engine=typesense_unified, fallback=false, degraded=none

| Rank | Relevant | Title | Source | Reasons |
|------|----------|-------|--------|---------|
| 1 | yes | Organisation 658560 | sra | taxonomy:commercial, term:commercial |
| 2 | yes | Organisation 220017 | sra | taxonomy:commercial, term:commercial |
| 3 | yes | Organisation 219951 | sra | taxonomy:commercial, term:commercial |
| 4 | yes | Organisation 219609 | sra | taxonomy:commercial, term:commercial |
| 5 | yes | Organisation 215347 | sra | taxonomy:commercial, term:commercial |
| 6 | yes | Organisation 214381 | sra | taxonomy:commercial, term:commercial |

## All cases

| ID | Query | Pass | Taxonomy | Results | Relevant |
|----|-------|------|----------|---------|----------|
| dir-prison-lawyer-01 | i need a prison lawyer | ✓ | prison_law | 10 | 10 |
| dir-brother-in-prison-01 | my brother is in prison | ✗ | — | 10 | 1 |
| dir-police-arrested-01 | police arrested me | ✓ | criminal_defence | 10 | 10 |
| mat-prison-lawyer-01 | i need a prison lawyer | ✓ | prison_law | 5 | 3 |
| dir-lost-job-01 | i lost my job | ✗ | — | 10 | 0 |
| dir-employment-tribunal-01 | employment tribunal unfair dismissal | ✓ | employment | 10 | 10 |
| dir-landlord-eviction-01 | my landlord is kicking me out | ✓ | housing | 10 | 10 |
| dir-section-21-01 | section 21 notice housing | ✓ | housing | 10 | 10 |
| dir-visa-refused-01 | my visa was refused | ✓ | immigration | 10 | 10 |
| dir-deportation-01 | facing deportation help | ✓ | immigration | 10 | 10 |
| dir-child-contact-01 | my ex won't let me see my child | ✗ | — | 10 | 0 |
| dir-divorce-01 | divorce solicitor near me | ✓ | family | 10 | 10 |
| dir-benefits-stopped-01 | benefits stopped | ✓ | welfare_benefits | 10 | 8 |
| dir-universal-credit-01 | universal credit appeal | ✓ | welfare_benefits | 10 | 10 |
| dir-no-will-01 | dad died without a will | ✗ | — | 1 | 1 |
| dir-doctor-mistake-01 | doctor made a mistake | ✗ | — | 1 | 0 |
| dir-car-accident-01 | injured in a car accident | ✗ | — | 3 | 3 |
| dir-consumer-refund-01 | company won't give refund | ✓ | consumer | 10 | 2 |
| dir-debt-bailiffs-01 | bailiffs coming for debt | ✓ | debt | 10 | 10 |
| dir-school-exclusion-01 | child excluded from school appeal | ✗ | prison_law | 10 | 0 |
| dir-sectioned-01 | sectioned under mental health act | ✓ | mental_health | 10 | 10 |
| dir-care-package-01 | council cut my care package | ✓ | community_care | 10 | 3 |
| dir-judicial-review-01 | judicial review council decision | ✓ | public_law | 10 | 10 |
| dir-business-contract-01 | breach of business contract | ✗ | — | 6 | 6 |
| dir-legal-aid-housing-01 | legal aid housing eviction | ✓ | housing | 10 | 10 |
| dir-employment-london-01 | employment lawyer London | ✓ | employment | 10 | 10 |
| dir-need-help-01 | i need help | ✓ | — | 5 | 0 |
| dir-legal-problem-01 | i have a legal problem | ✓ | — | 5 | 0 |
| mat-need-help-01 | i need help | ✓ | — | 0 | 0 |
| mat-vague-help-02 | help me | ✓ | — | 0 | 0 |
| mat-employment-01 | unfair dismissal at work | ✓ | employment | 5 | 3 |
| dir-good-divorce-lawyer-01 | good divorce lawyer | ✓ | family | 10 | 10 |
| dir-family-solicitor-01 | family solicitor | ✓ | family | 10 | 10 |
| dir-child-custody-solicitor-01 | child custody solicitor | ✓ | family | 10 | 10 |
| dir-legal-aid-divorce-01 | need legal aid divorce lawyer | ✓ | welfare_benefits | 10 | 10 |
| dir-free-family-lawyer-01 | free family lawyer | ✓ | family | 10 | 10 |
| dir-private-divorce-mcr-01 | private divorce solicitor Manchester | ✓ | family | 10 | 10 |