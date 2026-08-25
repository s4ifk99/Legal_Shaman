# Exa authority index (offline)

Batch Exa searches fill `web/data/coherence/authority/authorityExaIndex.json`.
The product reads that file only — it never calls Exa at query time.

## Setup

```bash
python3 -m venv scripts/exa/.venv
scripts/exa/.venv/bin/pip install -r scripts/exa/requirements-exa.txt
export EXA_API_KEY=…
```

## Nightly

```bash
./scripts/exa/run_nightly.sh
```

Then open a PR with any changes to `authorityExaIndex.json`.

## Manual

```bash
python scripts/exa/exa_area_fill.py --dry-run
python scripts/exa/exa_authority_fallback.py --query "…" --topic-key my-topic
```
