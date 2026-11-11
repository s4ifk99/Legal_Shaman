/** Canonical B2C free → paid plan copy and defaults (server + client safe). */

/** @deprecated Nov pilot: weekly unlimited is paused. Kept for legacy Stripe/status only. */
export const B2C_PAID_PRICE_GBP = 3.49

/** @deprecated Nov pilot: weekly unlimited is paused. Kept for legacy Stripe/status only. */
export const B2C_PAID_PRICE_LABEL = "£3.49 / week"

/** Three free distinct searches per account (soft limit; no weekly upsell in Nov pilot). */
export const B2C_FREE_SEARCH_LIMIT_DEFAULT = 3

export const B2C_ANALYTICS_INTERVAL = "week" as const

/** Nov Exp 6 — sole paid offer: one-time 99p privacy protection pilot. */
export const B2C_PRIVACY_PRICE_GBP = 0.99
export const B2C_PRIVACY_PRICE_LABEL = "99p"
/** Covered window for the privacy option once purchased (days). */
export const B2C_PRIVACY_COVER_DAYS = 30

export const PRIVACY_UPGRADE_COPY = {
  title: "Protect your search · 99p",
  body:
    "November pilot: for 99p we keep your search text private — we will not share it with third-party advertisers or use it later for our own purposes. Ask still runs on the same models and tools either way.",
  covered:
    "Applies to free-text searches you submit while protection is active (30 days). Account email and payment details are separate.",
  disclaimer:
    "This month we are testing whether people will pay for that protection. Interest is not a purchase until checkout completes.",
} as const
