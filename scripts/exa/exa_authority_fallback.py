#!/usr/bin/env python3
"""Exa last-resort fallback for empty authority topics — then index offline.

Flow:
  1. Compute topicKey for the query (same-area reuse).
  2. If topicKey already has pages in authorityExaIndex.json → skip Exa.
  3. Else call Exa (allowlisted domains only).
  4. On success, write pages + topic mapping into authorityExaIndex.json
     so the product / next eval never spends credits on that topic again.

Product Vite path NEVER imports this. It only reads the JSON index.

Examples:
  python scripts/exa/exa_authority_fallback.py \\
    --query "rail penalty fare wrong name England ORR"

  python scripts/exa/exa_authority_fallback.py --outliers

  python scripts/exa/exa_authority_fallback.py --topic-key penalty-fare --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

REPO = Path(__file__).resolve().parents[2]  # Legal_Shaman-vnext
AUTHORITY_DIR = REPO / "web" / "data" / "coherence" / "authority"
INDEX_PATH = AUTHORITY_DIR / "authorityExaIndex.json"
SEED_PATH = AUTHORITY_DIR / "authoritySeed.json"
DEFAULT_ENV_CANDIDATES = (
    REPO / ".env",
    REPO / "web" / ".env.local",
    Path.cwd() / ".env",
)
OUT_DIR = Path(__file__).resolve().parent / "runs"

# Keep in sync with coherence-intake/src/lib/authorityAllowlist.ts
INCLUDE_DOMAINS = [
    "legislation.gov.uk",
    "gov.uk",
    "citizensadvice.org.uk",
    "acas.org.uk",
    "sra.org.uk",
    "ico.org.uk",
    "moneyhelper.org.uk",
    "judiciary.uk",
    "bailii.org",
    "oiahe.org.uk",
    "orr.gov.uk",
    "nationalrail.co.uk",
    "victimsupport.org.uk",
    "police.uk",
    "askthe.police.uk",
    "nhs.uk",
    "ipo.gov.uk",
    "caa.co.uk",
    "rspca.org.uk",
    "cps.gov.uk",
    "legalombudsman.org.uk",
    "ofgem.gov.uk",
    "ofcom.org.uk",
    "lease-advice.org",
    "housing-ombudsman.org.uk",
    "gov.scot",
    "mygov.scot",
    "cas.org.uk",
    "nidirect.gov.uk",
    "gov.wales",
    "libertyhumanrights.org.uk",
    "taylor-rose.co.uk",
    "lawhive.co.uk",
    "harperjames.co.uk",
    "howell-jones.com",
    "levisolicitors.co.uk",
    "anthonygold.co.uk",
    "keystonelaw.com",
    "lyonsdavidson.co.uk",
]

BLOCKED_RE = re.compile(
    r"reddit\.com|rareddit\.com|quora\.com|facebook\.com|medium\.com|blogspot\.|"
    r"wordpress\.com|forbes\.com|expertmarket|justanswer|tiktok\.com",
    re.I,
)

STOP = set(
    """a an the and or of to in for on with my i we you is are was were be been being
    this that it at from by as if about into over after before can could would should
    will just so not no yes have has had do does did get got going england uk scotland
    wales britain british someone something anything everything please help advice
    legal question reddit thanks thank hi hello""".split()
)

TOPIC_PHRASES = [
    (re.compile(r"\bpenalty\s+fare\b", re.I), "penalty-fare"),
    (re.compile(r"\bout\s+of\s+sequence\b", re.I), "airline-out-of-sequence"),
    (
        re.compile(r"\b(unfair\s+terms?|consumer\s+rights\s+act).{0,40}(airline|flight|tos)\b", re.I),
        "airline-unfair-terms",
    ),
    (
        re.compile(r"\b(drill\s+track|malicious\s+communications|named.{0,20}threat)", re.I),
        "threats-malicious-comms",
    ),
    (
        re.compile(r"\b(stalking|harassment).{0,30}(daughter|child|minor|school)\b", re.I),
        "child-harassment-threats",
    ),
    (
        re.compile(
            r"\b(car\s+rental|hire\s+car).{0,40}(deposit|abroad|section\s*75|chargeback)\b",
            re.I,
        ),
        "car-rental-abroad-deposit",
    ),
    (re.compile(r"\bsection\s*75\b", re.I), "section-75-credit-card"),
    (re.compile(r"\b(road\s+traffic|hit\s+a\s+parked|duty\s+to\s+stop)\b", re.I), "rta-duty-to-stop"),
]


def load_env_file(path: Path) -> int:
    if not path.is_file():
        return 0
    loaded = 0
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() != "EXA_API_KEY" or os.environ.get("EXA_API_KEY"):
            continue
        value = value.strip().strip('"').strip("'")
        if not value or value == "YOUR_API_KEY":
            continue
        os.environ["EXA_API_KEY"] = value
        loaded += 1
    return loaded


def resolve_api_key(env_file: Path | None) -> str:
    paths: list[Path] = []
    if env_file:
        paths.append(env_file.expanduser())
    paths.extend(DEFAULT_ENV_CANDIDATES)
    for ep in paths:
        if load_env_file(ep):
            print(f"Loaded EXA_API_KEY from {ep}", file=sys.stderr)
            break
    key = os.environ.get("EXA_API_KEY", "").strip()
    if not key:
        raise SystemExit("EXA_API_KEY is not set.")
    return key


def authority_topic_key(text: str) -> str:
    raw = (text or "").strip()
    if not raw:
        return "unknown"
    for cre, key in TOPIC_PHRASES:
        if cre.search(raw):
            return key
    tokens = re.sub(r"[^a-z0-9\s-]", " ", raw.lower()).split()
    uniq: list[str] = []
    seen: set[str] = set()
    for t in tokens:
        if len(t) < 3 or t in STOP or t in seen:
            continue
        seen.add(t)
        uniq.append(t)
        if len(uniq) >= 6:
            break
    if len(uniq) < 2:
        return uniq[0] if uniq else "unknown"
    return "-".join(uniq[:4])


def host_ok(url: str) -> bool:
    if not url or BLOCKED_RE.search(url):
        return False
    try:
        host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    except Exception:
        return False
    if host.endswith(".gov.uk") or host == "gov.uk":
        return True
    return any(host == d or host.endswith("." + d) for d in INCLUDE_DOMAINS)


def load_index() -> dict[str, Any]:
    if INDEX_PATH.is_file():
        return json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    return {
        "meta": {"note": "Exa-learned authority cache", "pageCount": 0, "topicCount": 0},
        "topics": {},
        "pages": [],
    }


def save_index(idx: dict[str, Any]) -> None:
    idx["meta"] = {
        **(idx.get("meta") or {}),
        "note": (
            "Learned UK authority pages from Exa last-resort fallback. "
            "Product reads offline — never calls Exa."
        ),
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "pageCount": len(idx.get("pages") or []),
        "topicCount": len(idx.get("topics") or {}),
    }
    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text(json.dumps(idx, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def topic_already_indexed(idx: dict[str, Any], topic_key: str) -> bool:
    topic = (idx.get("topics") or {}).get(topic_key) or {}
    page_ids = topic.get("pageIds") or []
    if not page_ids:
        return False
    pages = {p.get("id"): p for p in idx.get("pages") or []}
    return any(pid in pages for pid in page_ids)


def extract_keywords(query: str, title: str, topic_key: str) -> list[str]:
    kws: list[str] = []
    seen: set[str] = set()

    def add(s: str) -> None:
        s = re.sub(r"\s+", " ", (s or "").strip().lower())
        if len(s) < 3 or s in seen:
            return
        seen.add(s)
        kws.append(s)

    # Lay-facing topic phrases first (must be words users actually type)
    add(topic_key.replace("-", " "))
    for phrase in re.findall(
        r"\b(?:penalty fare|out of sequence|unfair terms?|section 75|car rental|"
        r"malicious communications|drill track|job reference|working time|"
        r"road traffic accident|duty to stop|consumer rights|financial remedy|"
        r"northern ireland|ancillary relief|matrimonial)\b",
        query,
        flags=re.I,
    ):
        add(phrase)
    # Always keep core tokens from the lay query
    qtoks = [
        t
        for t in re.sub(r"[^a-z0-9\s]", " ", query.lower()).split()
        if len(t) >= 4 and t not in STOP
    ]
    for t in qtoks[:12]:
        add(t)
    for i in range(min(len(qtoks) - 1, 8)):
        add(f"{qtoks[i]} {qtoks[i+1]}")
    # Title tokens
    title_toks = [
        t
        for t in re.sub(r"[^a-z0-9\s]", " ", title.lower()).split()
        if len(t) >= 3 and t not in STOP
    ]
    for i, tok in enumerate(title_toks[:10]):
        add(tok)
        if i + 1 < len(title_toks):
            add(f"{title_toks[i]} {title_toks[i+1]}")
    return kws[:24]


def require_any_for(query: str, kws: list[str]) -> list[str]:
    """Prefer lay phrases that appear in the user query (not Exa jargon alone)."""
    q = query.lower()
    from_query = [k for k in kws if " " in k and k in q]
    if not from_query:
        from_query = [k for k in kws if " " not in k and re.search(rf"\b{re.escape(k)}\b", q)]
    multi = [k for k in kws if " " in k][:3]
    out: list[str] = []
    seen: set[str] = set()
    for k in from_query + multi + kws[:4]:
        if k in seen:
            continue
        seen.add(k)
        out.append(k)
        if len(out) >= 5:
            break
    return out or kws[:2]


def page_id_for(url: str, title: str) -> str:
    host = (urlparse(url).hostname or "page").lower().removeprefix("www.")
    host_slug = re.sub(r"[^a-z0-9]+", "-", host).strip("-")[:24]
    title_slug = re.sub(r"[^a-z0-9]+", "-", (title or "page").lower()).strip("-")[:48]
    return f"exa-{host_slug}__{title_slug or 'page'}"


def tier_for(url: str) -> str:
    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    if "legislation.gov.uk" in host:
        return "primary"
    if host.endswith(".gov.uk") or host in {
        "citizensadvice.org.uk",
        "acas.org.uk",
        "ico.org.uk",
        "orr.gov.uk",
        "police.uk",
        "sra.org.uk",
    }:
        return "secondary"
    if host in {
        "moneyhelper.org.uk",
        "victimsupport.org.uk",
        "nationalrail.co.uk",
        "oiahe.org.uk",
        "lawsociety.org.uk",
    }:
        return "tertiary"
    # firm domains
    if any(
        host == d or host.endswith("." + d)
        for d in (
            "taylor-rose.co.uk",
            "lawhive.co.uk",
            "harperjames.co.uk",
            "howell-jones.com",
            "levisolicitors.co.uk",
            "anthonygold.co.uk",
            "keystonelaw.com",
            "lyonsdavidson.co.uk",
        )
    ):
        return "firm"
    return "tertiary"


def index_results(
    idx: dict[str, Any],
    *,
    topic_key: str,
    query: str,
    results: list[dict[str, Any]],
    request_id: str | None,
) -> list[dict[str, Any]]:
    """Merge allowlisted Exa hits into index. Returns newly/updated pages."""
    now = datetime.now(timezone.utc).isoformat()
    pages_by_url = {p.get("url"): p for p in idx.get("pages") or []}
    topics = idx.setdefault("topics", {})
    topic = topics.setdefault(
        topic_key,
        {
            "topicKey": topic_key,
            "sampleQueries": [],
            "pageIds": [],
            "exaRequestIds": [],
            "updatedAt": now,
        },
    )
    if query and query not in topic["sampleQueries"]:
        topic["sampleQueries"] = (topic.get("sampleQueries") or [])[-4:] + [query[:400]]
    if request_id and request_id not in (topic.get("exaRequestIds") or []):
        topic.setdefault("exaRequestIds", []).append(request_id)
    topic["updatedAt"] = now

    written: list[dict[str, Any]] = []
    for r in results:
        url = (r.get("url") or "").strip()
        if not url or not r.get("allowed"):
            continue
        title = (r.get("title") or "Untitled").strip()
        pid = page_id_for(url, title)
        kws = extract_keywords(query, title, topic_key)
        require = require_any_for(query, kws)
        page = {
            "id": pid,
            "title": title,
            "url": url,
            "domain": (urlparse(url).hostname or "").lower().removeprefix("www."),
            "tier": tier_for(url),
            "keywords": kws,
            "requireAny": require,
            "topicKeys": list(
                {
                    *(pages_by_url.get(url, {}).get("topicKeys") or []),
                    topic_key,
                }
            ),
            "source": "exa-fallback",
            "indexedAt": now,
            "highlights": (r.get("highlights") or [])[:3],
            "summary": r.get("summary"),
        }
        pages_by_url[url] = page
        written.append(page)
        if pid not in topic["pageIds"]:
            topic["pageIds"].append(pid)

    idx["pages"] = list(pages_by_url.values())
    return written


def result_to_dict(r: Any) -> dict[str, Any]:
    url = getattr(r, "url", None) or ""
    return {
        "title": getattr(r, "title", None),
        "url": url,
        "allowed": host_ok(url),
        "published_date": getattr(r, "published_date", None)
        or getattr(r, "publishedDate", None),
        "highlights": list(getattr(r, "highlights", None) or []),
        "summary": getattr(r, "summary", None),
    }


def exa_search(query: str, num: int) -> tuple[list[dict[str, Any]], str | None]:
    from exa_py import Exa

    client = Exa(api_key=os.environ["EXA_API_KEY"])
    resp = client.search_and_contents(
        query,
        type="auto",
        num_results=num,
        include_domains=INCLUDE_DOMAINS,
        highlights={"num_sentences": 2},
        summary=True,
    )
    results = [result_to_dict(r) for r in (getattr(resp, "results", None) or [])]
    request_id = getattr(resp, "request_id", None) or getattr(resp, "requestId", None)
    return results, request_id


def build_exa_query(lay: str, topic_key: str) -> str:
    """Bias Exa toward official UK guidance for the topic."""
    hints = {
        "penalty-fare": "UK rail penalty fare notice appeal ORR National Rail Citizens Advice",
        "airline-out-of-sequence": "UK airline out of sequence ticket unfair terms Consumer Rights Act Citizens Advice",
        "airline-unfair-terms": "unfair contract terms airline Consumer Rights Act 2015 Citizens Advice GOV.UK",
        "threats-malicious-comms": "malicious communications online threats harassment stalking England police.gov.uk Victim Support",
        "child-harassment-threats": "harassment stalking threats to child England report crime Victim Support GOV.UK",
        "car-rental-abroad-deposit": "section 75 credit card car hire deposit abroad MoneyHelper Citizens Advice",
        "section-75-credit-card": "section 75 Consumer Credit Act MoneyHelper chargeback",
    }
    hint = hints.get(topic_key, "UK official guidance Citizens Advice GOV.UK")
    # Keep Exa query short-ish
    opener = re.sub(r"\s+", " ", lay.strip())[:280]
    return f"{opener}. {hint}"


# Known empty outliers from fresh LAUK batch (fallback targets)
DEFAULT_OUTLIER_QUERIES = [
    {
        "id": "1vth4j4",
        "topicHint": "airline-out-of-sequence",
        "query": (
            "KLM airline out of sequence charge unfair terms of service "
            "missed outbound flight Consumer Rights Act England"
        ),
    },
    {
        "id": "1vtghvb",
        "topicHint": "penalty-fare",
        "query": (
            "rail penalty fare notice issued with wrong name and date of birth "
            "enforceable England ORR appeal"
        ),
    },
    {
        "id": "1vtfvsv",
        "topicHint": "threats-malicious-comms",
        "query": (
            "drill track song naming child sexual threats harassment stalking "
            "malicious communications England report police Victim Support"
        ),
    },
    {
        "id": "1vtfmqt",
        "topicHint": "car-rental-abroad-deposit",
        "query": (
            "car rental deposit declined abroad Turkey section 75 credit card "
            "forced insurance charge MoneyHelper England"
        ),
    },
]


def process_one(
    *,
    query: str,
    topic_key: str | None,
    num: int,
    dry_run: bool,
    force: bool,
) -> dict[str, Any]:
    idx = load_index()
    key = topic_key or authority_topic_key(query)
    already = topic_already_indexed(idx, key)
    record: dict[str, Any] = {
        "topicKey": key,
        "query": query,
        "alreadyIndexed": already,
        "exaCalled": False,
        "pagesIndexed": 0,
        "allowedHits": 0,
    }
    if already and not force:
        print(f"SKIP Exa — topic `{key}` already indexed", file=sys.stderr)
        topic = idx["topics"][key]
        record["pageIds"] = topic.get("pageIds")
        return record

    exa_q = build_exa_query(query, key)
    record["exaQuery"] = exa_q
    if dry_run:
        print(f"DRY-RUN topic={key} exaQuery={exa_q[:120]}…", file=sys.stderr)
        return record

    resolve_api_key(None)
    print(f"Exa fallback topic=`{key}`…", file=sys.stderr)
    results, request_id = exa_search(exa_q, num)
    record["exaCalled"] = True
    record["requestId"] = request_id
    record["allowedHits"] = sum(1 for r in results if r.get("allowed"))

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "mode": "authority-fallback",
        "topicKey": key,
        "query": query,
        "exaQuery": exa_q,
        "includeDomains": INCLUDE_DOMAINS,
        "request_id": request_id,
        "results": results,
    }
    (OUT_DIR / f"{stamp}_authority-fallback_{key}.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    if record["allowedHits"] == 0:
        print(f"FAIL topic=`{key}` — no allowlisted Exa hits", file=sys.stderr)
        return record

    written = index_results(
        idx, topic_key=key, query=query, results=results, request_id=request_id
    )
    save_index(idx)
    record["pagesIndexed"] = len(written)
    record["pageIds"] = [p["id"] for p in written]
    print(
        f"INDEXED topic=`{key}` pages={len(written)} → {INDEX_PATH}",
        file=sys.stderr,
    )
    return record


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Exa last-resort fallback; index results by topicKey (offline reuse)."
    )
    parser.add_argument("--query", help="Single lay / rewritten query")
    parser.add_argument("--topic-key", help="Override topic key")
    parser.add_argument(
        "--outliers",
        action="store_true",
        help="Process the 4 known fresh-batch empties",
    )
    parser.add_argument("--num", type=int, default=8)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Call Exa even if topicKey already indexed",
    )
    args = parser.parse_args()

    jobs: list[tuple[str, str | None]] = []
    if args.outliers:
        for o in DEFAULT_OUTLIER_QUERIES:
            jobs.append((o["query"], o.get("topicHint")))
    elif args.query:
        jobs.append((args.query, args.topic_key))
    else:
        parser.error("Provide --query or --outliers")

    print(
        "NOTE: Exa is last-resort only. Successful topics are cached in "
        f"{INDEX_PATH.name} for offline reuse.",
        file=sys.stderr,
    )

    summary = []
    for query, tkey in jobs:
        summary.append(
            process_one(
                query=query,
                topic_key=tkey or args.topic_key,
                num=args.num,
                dry_run=args.dry_run,
                force=args.force,
            )
        )

    print(json.dumps({"summary": summary}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
