# SRA API → index audit

This documents what the **SRA Data Share API V1** provides, what **`npm run sra:sync`** persists, and what reaches the unified **`legal_entities`** Typesense index.

Run a live comparison:

```bash
cd web && npm run sra:audit
cd web && npm run sra:status    # row counts + last sync
```

## APIs in use

| Endpoint | Used by | Purpose |
|----------|---------|---------|
| `organisation/GetAll` | `sra:sync` | Bulk ingest (~all firms) |
| `organisation/Get?OrganisationId=` | `sra:lookup`, identity recovery | Single-firm refresh |
| *(not used)* Person / firm roster APIs | — | Individuals not in bulk sync |

We do **not** store the raw API JSON. Only normalised columns in `sra_organisations` — remapping new SRA fields requires a **full re-sync** after code changes.

## What we extract today

From each organisation record (`lib/search/sra-document.ts` → `normaliseSraOrganisation`):

| Stored / indexed | Source in API (best-effort keys) |
|------------------|----------------------------------|
| `sraId`, `id` | `OrganisationId` |
| Names (`displayName`, `organisationName`, `tradingName`, `firmName`) | `AuthorisedName`, `TradingNames`, `OrganisationName`, … |
| `phone` | **First office only** — `Offices[].Telephone` |
| `city`, `postcode`, `county`, `country` | **First office only** |
| `searchText` | Concatenation of names, phones, addresses, **AreasOfLaw text** |
| `sraProfileUrl` | **Constructed** consumer check URL (not from API) |

At index time (`sraOrganisationToDocument`):

| Index field | How populated |
|-------------|----------------|
| `practiceAreas` | Text taxonomy match on `searchText` |
| `practiceAreaSlugs` | **Heuristic projection** on name/description (`practice-area-projection.ts`) — not direct API enum mapping |
| `website` | Regex on `searchText` only — **not from SRA Website field** |
| `email` | Enrichment pipeline only |
| `latitude` / `longitude` | Geocode from postcode |

## What SRA publishes but we ignore

Per [SRA data sharing terms](https://www.sra.org.uk/sra/how-we-work/privacy-data-information/data-sharing/terms-conditions/) (Nov 2024), the register includes:

| SRA field | Impact of missing it |
|-----------|----------------------|
| **Website address(es)** | Website discovery crawl must guess; many false positives |
| **Business email** | Contact enrichment only; slower / less accurate |
| **Areas of law** (structured list) | Only folded into `searchText`; slugs are projected, not authoritative |
| **Reserved activities** | Cannot match tribunal / reserved work capabilities |
| **Authorisation status / dates** | Closed or non-authorised firms may still appear in search |
| **Licence / constitution type** | No filter for LLP, licensed body, etc. |
| **Office type** (head vs branch) | Branch locations and phones dropped |
| **All offices** | Multi-site firms under-represented |
| **Previous names** | Rebrands harder; identity recovery overuses external search |
| **Company registration number** | No Companies House join |
| **Freelance / regulator** | No entity subtype |

## Current database snapshot (local audit, Jun 2026)

From `npm run sra:audit` against Postgres:

| Metric | Value |
|--------|------:|
| `sra_organisations` rows | 25,052 |
| With `city` | 23,308 (93%) |
| With `postcode` | 22,325 (89%) |
| With `phone` | **0 (0%)** |
| With `tradingName` | **0 (0%)** |
| Placeholder `displayName` (`SRA organisation …`) | **17,108 (68%)** |

So the index is geo-heavy but **contact-poor** and **name-poor** for most firms. That matches relying on crawler/enrichment for website/phone and identity recovery for names — not on bulk API fields being mapped correctly (or present under different JSON keys in live GetAll).

## Known quality issues

1. **Placeholder display names (68%)** — `AuthorisedName` / trading names missing or not mapped. Mitigation: `sra:recover:identities`, Law Society, Serper.
2. **Zero phones in DB** — Either live API uses different office phone keys than our mapper, or GetAll rows omit phones. Worth a live payload key scan after a successful `sra:audit --limit=100`.
3. **Practice areas** — API areas only in `searchText`; index slugs from projection heuristics (see practice-area taxonomy gate).
4. **No raw payload** — Cannot audit “what did the API actually send?” historically without re-fetching.
5. **GetAll vs Get** — Bulk sync uses GetAll only; per-org `Get` used in recovery but not merged into bulk ingest.

## Recommendations (priority)

1. **Persist `rawPayload` JSONB** on `sra_organisations` at sync time.
2. **Map `Website` and `Email`** from API into columns; pass through to Typesense.
3. **Map `AreasOfLaw` → `practiceAreaSlugs`** using the SRA’s published area-of-law list (map to `LEGAL_ISSUE_TAXONOMY` slugs).
4. **Store `authorisationStatus`** and filter non-authorised orgs from public search.
5. **Index all offices** (or head + branches table) for geo and phone completeness.
6. **Extend `sra:audit`** after changes to verify new keys hit 100% on a live sample.

## Related commands

```bash
npm run sra:sync              # full GetAll → Postgres + Meilisearch
npm run sra:audit             # field coverage report
npm run sra:recover:identities  # fix placeholder names
npm run search:index:sra      # Postgres → Typesense legal_entities
```

See also: [sra-api-fields.md](./sra-api-fields.md)
