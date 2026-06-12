# SRA Data Share API — Organisation `GetAll`

## Base URL

`https://sra-prod-apim.azure-api.net/datashare/api/V1/organisation/GetAll`

## Authentication

1. Register at [SRA API developer portal](https://sra-prod-apim.developer.azure-api.net) and subscribe to **SRA Data Share API Version V1**.
2. Copy the **primary or secondary subscription key** from your profile.
3. Send on every request (Azure API Management convention):

```http
Ocp-Apim-Subscription-Key: <your-key>
```

Confirm header name in the portal OpenAPI if it differs.

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| **401** on `GetAll` | Missing/wrong subscription key, expired key, or key from a different APIM product. Regenerate in the [developer portal](https://sra-prod-apim.developer.azure-api.net). |
| **403** | Subscription not active for **SRA Data Share API Version V1**, or account restrictions. |
| **`Missing SRA_APIM_SUBSCRIPTION_KEY` in sync** | Key not in environment; for local runs use `web/.env.local` (loaded by `npm run sra:sync` / `npm run sra:probe`). |
| **HTTP 200 but 0 organisations after sync** | JSON shape changed; inspect one response body and extend `extractRows` / `normaliseSraOrganisation` in the sync path. |
| **Timeouts / network errors** | Firewall, VPN, or regional blocking; try from another network or CI. |

**Quick check from the repo:** `cd web && npm run sra:probe` (uses `.env` / `.env.local`).

### Quick probe (Python 3)

A minimal GET only prints **401** until you add your key. Use the same header the portal documents (usually `Ocp-Apim-Subscription-Key`):

```python
import json
import os
import urllib.request

url = "https://sra-prod-apim.azure-api.net/datashare/api/V1/organisation/GetAll"
key = os.environ["SRA_APIM_SUBSCRIPTION_KEY"]  # never commit this

req = urllib.request.Request(
    url,
    headers={
        "Cache-Control": "no-cache",
        "Ocp-Apim-Subscription-Key": key,
    },
    method="GET",
)

with urllib.request.urlopen(req) as response:
    print(response.status)
    body = response.read()
    # Inspect shape; may be a list or a wrapper with value/items + nextLink
    data = json.loads(body)
    if isinstance(data, list):
        print(f"array, length={len(data)}")
    elif isinstance(data, dict):
        print("object keys:", list(data.keys())[:20])
    else:
        print(type(data))
```

### JavaScript / TypeScript (`fetch`, Node only)

**Do not** paste your subscription key into frontend or Next.js client code — anyone can read it. Use **Node** (terminal script), **server-only** routes, or env vars (as in `web/scripts/sync-sra-meili.ts`).

`response.text()` returns a **Promise**; you must `await` it or use `.then()`, or you will log `[object Promise]` instead of the body:

```ts
const url = "https://sra-prod-apim.azure-api.net/datashare/api/V1/organisation/GetAll";
const key = process.env.SRA_APIM_SUBSCRIPTION_KEY;
if (!key) throw new Error("Set SRA_APIM_SUBSCRIPTION_KEY");

const res = await fetch(url, {
  method: "GET",
  headers: {
    "Cache-Control": "no-cache",
    "Ocp-Apim-Subscription-Key": key,
  },
});

console.log(res.status);
const text = await res.text();
console.log(text.slice(0, 500)); // preview; full payload can be huge

// Or, if the body is JSON:
// const data = await res.json();
```

## Pagination

The live API may return:

- A **JSON array** of organisations (single page), or
- A **wrapper object** with a collection property (`items`, `data`, `value`, `organisations`, etc.) and optionally `nextLink`, `continuationToken`, `skip`/`take`, or query parameters for paging.

The sync script [`web/scripts/sync-sra-meili.ts`](../web/scripts/sync-sra-meili.ts) normalises defensively: it unwraps common wrapper shapes and follows `nextLink` / appends `skip` when the OpenAPI documents them. **After subscribing**, run one manual fetch and adjust the script if your product uses a different shape.

## Field mapping (normalisation)

The ingest script maps **whichever fields exist** on each record into Meilisearch documents:

| Meilisearch field   | Typical SRA / JSON sources (first match wins) |
|---------------------|-----------------------------------------------|
| `id`                | `OrganisationId`, `organisationId`, `id`    |
| `businessName`      | `AuthorisedName`, `OrganisationName`, `OfficeName`, first `TradingName` / `TradingNames` (not the numeric SRA id) |
| `phone`             | First office `Telephone`, `Phone`, `PhoneNumber`, etc. |
| `sraId`             | Same as `id` when numeric / string SRA reference |
| `city`, `postcode`, `county` | From head / first office: `PostTown`, `postTown`, `Town`, `PostCode`, `postcode`, address lines |
| `searchText`        | Concatenation of name, trading names, addresses, postcodes for retrieval |

## Attribution

Per [SRA data sharing terms](https://www.sra.org.uk/sra/how-we-work/privacy-data-information/data-sharing/), products must acknowledge the SRA as the source with a link to their attribution statement. The web UI includes short copy and a link on SRA-sourced results.

## Local / CI secrets

| Variable | Purpose |
|----------|---------|
| `SRA_APIM_SUBSCRIPTION_KEY` | Fetch `GetAll` |
| `MEILISEARCH_HOST` | e.g. `https://xxx.meilisearch.io` or `http://localhost:7700` |
| `MEILISEARCH_API_KEY` | Key with **documents.add** for sync; use a restricted **search** key in Next.js if possible |
| `DATABASE_URL` (optional) | MySQL connection string; when set, `sra:sync` upserts table `sra_organisations` before each Meilisearch batch |

Do not commit subscription keys, database passwords, or Meilisearch master keys.
