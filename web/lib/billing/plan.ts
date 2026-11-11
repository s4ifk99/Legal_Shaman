/** Canonical B2C free → paid plan copy and defaults (server + client safe). */

export const B2C_PAID_PRICE_GBP = 3.49

/** Human-facing price line used in banners, paywalls, and billing status. */
export const B2C_PAID_PRICE_LABEL = "£3.49 / week"

/** Three free distinct searches per account, then paid unlimited. */
export const B2C_FREE_SEARCH_LIMIT_DEFAULT = 3

export const B2C_ANALYTICS_INTERVAL = "week" as const

/** Nov Exp 6 — optional one-time privacy upgrade (keep weekly plan as fallback). */
export const B2C_PRIVACY_PRICE_GBP = 0.99
export const B2C_PRIVACY_PRICE_LABEL = "99p privacy upgrade"
/** Covered window for the privacy option once purchased (days). */
export const B2C_PRIVACY_COVER_DAYS = 30

export const PRIVACY_UPGRADE_COPY = {
  title: "Optional 99p privacy upgrade",
  body:
    "Search stays free. The optional privacy upgrade is a November pilot: for 30 days we will not share your search text with third-party model providers for training, and we will not use it to train our own models. Directory signposting still works either way.",
  covered:
    "Covers: free-text search queries you submit while the upgrade is active. Does not cover: account email, payment metadata, or aggregated analytics without query text.",
  disclaimer:
    "Interest is not a purchase. We will not claim a privacy guarantee until provider exclusions are verified for each LLM/analytics vendor.",
} as const
