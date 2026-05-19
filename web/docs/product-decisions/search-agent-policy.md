# Search agent policy (product decisions)

Status: **Confirmed** (May 2026)  
Scope: `/find-a-lawyer` guided triage, directory search ranking, and clarification UX.

Implementation: `web/lib/legal-search/orchestration/`

---

## 1. Default funding priority

When the user has not clearly chosen how to pay:

1. **Free / pro bono help** first  
2. **Legal aid providers** next  
3. **Paid / private services** after  

If the user **clearly asks** for a private solicitor, fixed fee, or paid service, **prioritize private results** and route order (`private` → `pro_bono` → `legal_aid`).

Signals for private intent include: “private solicitor”, “hire a lawyer”, “fixed fee”, “pay for”.

---

## 2. Interpretation of “lawyer” or “solicitor”

Treat **broadly** as any suitable **legal-help provider**, not only private solicitors:

- Law centres and advice charities  
- Legal aid providers  
- Pro bono clinics  
- SRA-regulated firms and directory listings  

Do not assume the user wants a paid private firm unless they say so.

---

## 3. Clarification style

- Prefer **MCQ-style refinement** with **answer chips**  
- Avoid long free-text clarification unless necessary (e.g. location postcode when chips are insufficient)  
- Questions should be short and scannable  

---

## 4. Results behaviour

- **Show results immediately** whenever possible  
- Ask refinement questions **while results remain visible** (inline on the results view)  
- Refinements **reprioritize** results (section order, boosts, diversity) — **do not hard-filter** matches away unless the user explicitly applies a narrow filter  

---

## 5. Location

- **Optional** — never block search because location is missing  
- Use location to improve **ranking** and **map** placement when provided  
- Ask for location **after** first results when helpful  

---

## 6. Urgency

When urgent risk is detected:

- Show **urgent signposting** and **emergency / public-service guidance**  
- Show **normal search results** at the same time  
- **Prioritize urgent-capable providers** in ranking where data supports it  
- **Do not create friction** (no blocking clarification) before urgent signposting is shown  

---

## 7. Source transparency

**Do not** use subjective trust labels such as “verified” or “trusted” in user-facing copy.

Instead, show **where data came from**, for example:

| Label | When |
|-------|------|
| GOV.UK legal aid data | Legal aid directory / LAA-sourced records |
| SRA-regulated organisation | SRA register entries |
| Curated directory listing | Internal curated / pro bono listings |
| Law centre | Law centre entity type |
| Law Society directory | External Law Society signpost |
| External signposting source | Web fallback / external directory |

Internal `verified` flags may still exist for ranking; they must not be shown as user-facing trust badges.

---

## 8. Session context

- **Start fresh by default** for each new legal issue  
- **Do not** automatically reuse prior filters across different matters  
- May **optionally suggest** “Reuse previous filters?” — never assume reuse  

---

## 9. Low-confidence queries

Order of operations:

1. Show **emergency help guidance** (999 / immediate danger)  
2. Clarify whether the user is in **immediate danger or an emergency** (MCQ chips)  
3. Ask **broad issue** MCQ questions  
4. If the matter was dismissed as non-emergency / civil, help **narrow the civil / legal issue**  

Search should still run where possible alongside this flow (see §4).

---

## Related code

| Concern | Module |
|---------|--------|
| Orchestration decisions | `lib/legal-search/orchestration/search-agent-policy.ts` |
| Funding route order | `lib/legal-search/triage/funding-router.ts` (uses policy) |
| Triage completeness | `lib/legal-search/triage/completeness.ts` |
| Source labels | `lib/legal-search/orchestration/source-provenance.ts` |
| Session freshness | `lib/legal-search/orchestration/session-context.ts` |
