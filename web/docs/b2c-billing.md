# B2C billing

The B2C plans are:

- `free`: one distinct new case search per account (lifetime). Follow-up
  questions and internal agent calls do not consume additional searches.
- `paid`: £3.49 per week with unlimited product searches, subject to
  abuse and transport rate limits. Entitlement is tied to the signed-in
  account (`users.plan`).

## Provider setup

1. In Stripe, create a GBP 3.49 recurring Price with a weekly interval and
   `interval_count=1`. Put its ID in `STRIPE_PRICE_PAID_WEEKLY`
   (legacy `STRIPE_PRICE_PAID_4_WEEK` is still read as a fallback).
2. Configure Stripe Checkout and send subscription events to
   `/api/billing/stripe-webhook`. Set `STRIPE_WEBHOOK_SECRET`.
3. In RevenueCat, connect the Stripe account, configure the web billing
   entitlement for the paid product, and use the same Legal Shaman user ID as
   the RevenueCat app user ID. Configure RevenueCat webhooks to
   `/api/billing/revenuecat-webhook` and set `REVENUECAT_WEBHOOK_SECRET`.
4. Add `NEXT_PUBLIC_POSTHOG_KEY`. Autocapture and session recording are
   disabled because legal-intake text can be sensitive; only explicit product
   funnel events are sent.

Stripe processes payment. RevenueCat provides entitlement synchronisation and
cross-platform subscription visibility. Legal Shaman mirrors the result into
the local `users.plan` field, which is enforced server-side.

Never grant paid access from a browser-only flag. Test Stripe and RevenueCat
webhooks in sandbox mode before switching the price or endpoints to live mode.
