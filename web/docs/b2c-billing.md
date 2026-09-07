# B2C billing

The B2C plans are:

- `free`: one distinct new case search per account (lifetime). Follow-up
  questions and internal agent calls do not consume additional searches.
- `paid`: £3.49 per week with unlimited product searches, subject to
  abuse and transport rate limits. Entitlement is tied to the signed-in
  account (`users.plan`).

## Provider setup

1. Live weekly price: `price_1UD4FAJl7fZiwYvchpPomyJm` (GBP 3.49 / week) on product
   `prod_VAGys64vAPjN6O`. Env: `STRIPE_PRICE_PAID_WEEKLY` (legacy 4-week
   `price_1U9wQcJl7fZiwYvcl8LsjbWq` via `STRIPE_PRICE_PAID_4_WEEK`).
2. Set `STRIPE_SECRET_KEY` (Dashboard → Developers → API keys, live secret).
3. Webhook endpoint: `https://www.legalshaman.com/api/billing/stripe-webhook`
   for `checkout.session.completed` and `customer.subscription.*`.
   Set `STRIPE_WEBHOOK_SECRET` to the endpoint signing secret.
4. In RevenueCat, connect the Stripe account, configure the web billing
   entitlement for the paid product, and use the same Legal Shaman user ID as
   the RevenueCat app user ID. Configure RevenueCat webhooks to
   `/api/billing/revenuecat-webhook` and set `REVENUECAT_WEBHOOK_SECRET`.
5. Add `NEXT_PUBLIC_POSTHOG_KEY`. Autocapture and session recording are
   disabled because legal-intake text can be sensitive; only explicit product
   funnel events are sent.

Stripe processes payment. RevenueCat provides entitlement synchronisation and
cross-platform subscription visibility. Legal Shaman mirrors the result into
the local `users.plan` field, which is enforced server-side.

Never grant paid access from a browser-only flag. Test Stripe and RevenueCat
webhooks in sandbox mode before switching the price or endpoints to live mode.
