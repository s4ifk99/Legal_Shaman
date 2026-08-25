#!/usr/bin/env bash
# Nightly Exa authority fill → offline index → ready for PR.
# Requires: EXA_API_KEY in the environment (Cloud Agent secret / local .env).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PYTHON="${EXA_PYTHON:-python3}"
if [[ -x "$ROOT/scripts/exa/.venv/bin/python" ]]; then
  PYTHON="$ROOT/scripts/exa/.venv/bin/python"
fi

echo "==> Installing Exa deps (if needed)"
"$PYTHON" -m pip install -q -r scripts/exa/requirements-exa.txt

echo "==> Area fill (skips topics already indexed)"
"$PYTHON" scripts/exa/exa_area_fill.py

echo "==> Known outliers fill"
"$PYTHON" scripts/exa/exa_authority_fallback.py --outliers

INDEX="web/data/coherence/authority/authorityExaIndex.json"
if [[ ! -f "$INDEX" ]]; then
  echo "ERROR: missing $INDEX after run" >&2
  exit 1
fi

echo "==> Index ready: $INDEX"
"$PYTHON" - <<'PY'
import json
from pathlib import Path
p = Path("web/data/coherence/authority/authorityExaIndex.json")
idx = json.loads(p.read_text(encoding="utf-8"))
meta = idx.get("meta") or {}
print(f"pages={meta.get('pageCount')} topics={meta.get('topicCount')} updated={meta.get('updated')}")
PY
