# Exp 6 — 99p privacy upgrade pilot (11 Nov 2026)

## Covered-data definition

- **Covered (while upgrade active, 30 days):** free-text search / Ask queries the user submits.
- **Not covered:** account email, payment metadata, or aggregated analytics that do not include query text.
- UI copy lives in `PRIVACY_UPGRADE_COPY` (`web/lib/billing/plan.ts`) and must stay aligned with this note.

## Stripe 99p price

**Skipped — interest-only this week.**  
`STRIPE_PRICE_PRIVACY_99P` unset → `/api/billing/privacy-checkout` records `privacy_upgrades.status = interest` and does not charge. Charging path code is ready when the price ID is set.

## Napkin math (£0.99 one-time)

Assumptions for one day of use after purchase:

| Line | Estimate |
| --- | --- |
| Stripe UK card fee on £0.99 | ~£0.20 + 1.5% ≈ **£0.22** (ballpark; confirm live Stripe pricing) |
| Avg LLM / Ask cost for a light day (few searches) | ~**£0.05–£0.25** depending on model + retrieval |
| **Gross after Stripe** | ~£0.77 |
| **Net vs light LLM day** | roughly **£0.50–£0.70** contribution before infra |
| Heavy Ask day | can erase the margin; privacy SKU is a pilot signal, not a profit centre |

One-liner: **£0.99 − ~£0.22 Stripe − ~£0.10 LLM ≈ ~£0.67 contribution on a light day; heavy usage can go negative — treat as willingness-to-pay signal.**

## Weekly £3.49 plan

Remains untouched (`B2CBillingBanner` + subscription checkout). Privacy card is additive only.
