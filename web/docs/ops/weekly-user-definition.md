# Weekly user definition (November 2026)

For the shareholder “100 users per week” target:

**A weekly user = a distinct PostHog `distinct_id` that fired `search_completed` at least once in the calendar week (Europe/London).**

Secondary metrics (do not count toward the 100 unless also completing a search):

- `provider_saved` — shortlisted a provider
- Self-reported next step (focus groups / surveys)

Funnel events (explicit only; autocapture off):

1. `visit` / `return_visit`
2. `search_started`
3. `search_completed` ← primary
4. `result_viewed`
5. `provider_saved`

Channel props: `landing`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`.
