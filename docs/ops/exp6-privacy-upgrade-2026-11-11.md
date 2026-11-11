# Exp 6 — 99p privacy protection (sole paid model, Nov 2026)

## Product decision (11 Nov)

- **Only paid offer:** 99p privacy protection for search text.
- **£3.49 / week unlimited:** paused / scraped from Ask UI for this pilot.
- Goal: test whether people will pay to keep searches private.

## What “private” means (pilot)

- We will **not** share protected search text with third-party advertisers (or similar third parties for that purpose).
- We will **not** keep that search text to use later for our own purposes.
- Ask still uses the same models and tools; the purchase is about protecting the query data, not changing the research stack.

## Covered-data definition

- **Covered (while protection active, 30 days):** free-text search / Ask queries the user submits.
- **Not covered:** account email, payment metadata, or aggregated analytics that do not include query text.
- UI copy: `PRIVACY_UPGRADE_COPY` in `web/lib/billing/plan.ts`.

## Stripe 99p price

Interest-only until `STRIPE_PRICE_PRIVACY_99P` is set. Charging helpers already exist in `web/lib/billing/stripe.ts`.

## Weekly £3.49

`B2CBillingBanner` is a no-op. Legacy Stripe weekly price IDs remain in code for existing subscribers / rollback only.
