# Legal Shaman vnext (local hybrid)

Production UI from `s4ifk99/Legal_Shaman` powered by R&D Coherence intake quality.

## Run

```bash
cd web
npm install
# .env.local already sets ENABLE_COHERENCE_ASK=1 + OpenRouter
npm run dev -- -H 127.0.0.1 -p 3000
```

Open: http://127.0.0.1:3000/ask-the-shaman

Classic Ask (escape hatch): http://127.0.0.1:3000/ask-the-shaman?classic=1

## What was grafted from R&D

- Authority stack (seed + firm index + Exa cache) + query rewrite
- ReformulationGate before Overview / Find help
- Parking-safe Answer packs + wiki pathway guards
- oslawPreflight + `/api/url-check`
- Session fields for reformulation / authority hits

Product path still never calls Exa live.

## Free services index (dialable charities)

- `web/data/coherence/freeServicesIndex.json` — helplines / charities per `area-*` topic
- `web/lib/coherence/matchFreeServices.ts` — ranks dialables for Matching Help **Free services**
- Offline fill:

```bash
cd "LS R&D/_Meta/scripts"
# Promote signpost phone orgs → freeServicesIndex (run after signpost edits)
../.venv/bin/python import_signposts_to_free_services.py
# Exa niche discovery per area-* (requires EXA_API_KEY in LS R&D/.env)
source ../../.env
../.venv/bin/python exa_free_services_fill.py --num 4
```
