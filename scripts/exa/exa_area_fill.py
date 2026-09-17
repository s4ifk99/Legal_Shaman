#!/usr/bin/env python3
"""Smarter Exa fill: one curated hunt per gap topic-area (not per Reddit post).

Uses the same index writer as exa_authority_fallback.py.
Spends a small fixed number of Exa calls (~2 per major area).

Usage:
  python scripts/exa/exa_area_fill.py --dry-run
  python scripts/exa/exa_area_fill.py
  python scripts/exa/exa_area_fill.py --areas crime,housing,probate
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Reuse fallback helpers
sys.path.insert(0, str(Path(__file__).resolve().parent))
from exa_authority_fallback import (  # noqa: E402
    INDEX_PATH,
    extract_keywords,
    index_results,
    load_index,
    process_one,
    require_any_for,
    save_index,
    topic_already_indexed,
)

# area id → curated Exa queries (UK official / CA / ACAS biased)
AREA_HUNTS: dict[str, dict] = {
    "crime": {
        "topicKey": "area-crime-police-harassment",
        "layKeywords": [
            "harassment",
            "stalking",
            "assault",
            "report a crime",
            "police",
            "malicious communications",
            "threatening behaviour",
            "criminal damage",
            "victim support",
            "neglect of duty",
            "dbs",
            "conviction",
        ],
        "queries": [
            "England report crime harassment stalking assault malicious communications GOV.UK police.uk Victim Support CPS",
            "England criminal damage threats police complaint neglect of duty Citizens Advice",
        ],
    },
    "probate": {
        "topicKey": "area-wills-probate-inheritance",
        "layKeywords": [
            "probate",
            "will",
            "inheritance",
            "executor",
            "estate",
            "intestate",
            "letters of administration",
            "inheritance tax",
            "contest a will",
        ],
        "queries": [
            "England probate apply for probate inheritance will executor GOV.UK Citizens Advice",
            "England contest a will inheritance dispute intestacy Citizens Advice",
        ],
    },
    "housing": {
        "topicKey": "area-housing-landlord-tenant",
        "layKeywords": [
            "landlord",
            "tenant",
            "tenancy",
            "deposit",
            "eviction",
            "section 21",
            "section 8",
            "disrepair",
            "rent arrears",
            "leasehold",
            "shelter",
        ],
        "queries": [
            "England landlord tenant eviction section 21 deposit protection disrepair Citizens Advice GOV.UK Shelter",
            "England rent arrears private rented sector possession claim GOV.UK",
        ],
    },
    "consumer": {
        "topicKey": "area-consumer-goods-traders",
        "layKeywords": [
            "consumer rights",
            "faulty",
            "refund",
            "trader",
            "builder",
            "roofer",
            "warranty",
            "cancelling",
            "deposit back",
            "unfair terms",
            "dealership",
        ],
        "queries": [
            "England consumer rights faulty goods services builder trader refund Citizens Advice GOV.UK",
            "England cancel contract deposit refund Consumer Rights Act unfair terms",
        ],
    },
    "employment": {
        "topicKey": "area-employment-workplace",
        "layKeywords": [
            "employer",
            "dismissal",
            "redundancy",
            "holiday pay",
            "sick leave",
            "acas",
            "unfair dismissal",
            "workplace harassment",
            "wages",
            "working time",
            "constructive dismissal",
        ],
        "queries": [
            "England employment rights dismissal redundancy holiday pay ACAS GOV.UK",
            "England workplace bullying harassment sick leave unpaid wages ACAS Citizens Advice",
        ],
    },
    "motoring": {
        "topicKey": "area-motoring-parking-rta",
        "layKeywords": [
            "parking fine",
            "pcn",
            "speeding",
            "penalty points",
            "driving licence",
            "road traffic accident",
            "exceptional hardship",
            "motor insurance",
            "penalty fare",
        ],
        "queries": [
            "England parking ticket PCN appeal speeding points driving disqualification GOV.UK Citizens Advice",
            "England exceptional hardship totting up road traffic accident duty to stop GOV.UK",
        ],
    },
    "debt": {
        "topicKey": "area-debt-bailiffs-finance",
        "layKeywords": [
            "debt",
            "bailiff",
            "enforcement officer",
            "ccj",
            "iva",
            "debt collector",
            "moneyhelper",
            "credit card",
            "section 75",
        ],
        "queries": [
            "England bailiffs debt enforcement CCJ IVA MoneyHelper Citizens Advice",
            "England debt collector rights what bailiffs can take Citizens Advice",
        ],
    },
    "business": {
        "topicKey": "area-business-companies",
        "layKeywords": [
            "company",
            "director",
            "limited company",
            "shareholder",
            "companies house",
            "insolvency",
            "partnership",
        ],
        "queries": [
            "England limited company director duties Companies House GOV.UK",
            "England company insolvency striking off shareholder rights GOV.UK",
        ],
    },
    "neighbour": {
        "topicKey": "area-neighbour-boundary-trees",
        "layKeywords": [
            "neighbour disputes",
            "boundary",
            "hedge",
            "tree or hedge",
            "fence",
            "noise complaint",
            "antisocial behaviour",
        ],
        "queries": [
            "England neighbour disputes trees hedges boundary fence Citizens Advice",
            "England noisy neighbour antisocial behaviour council Citizens Advice",
        ],
    },
    "family": {
        "topicKey": "area-family-children-divorce",
        "layKeywords": [
            "divorce",
            "child arrangements",
            "parental responsibility",
            "financial remedy",
            "tolata",
            "contact with child",
            "grandparents rights",
        ],
        "queries": [
            "England divorce child arrangements parental responsibility GOV.UK Citizens Advice",
            "England TOLATA cohabitation financial remedy family court GOV.UK",
        ],
    },
    "education": {
        "topicKey": "area-education-students",
        "layKeywords": [
            "school",
            "university",
            "student complaint",
            "exclusion",
            "school attendance",
            "oia",
            "university disciplinary",
        ],
        "queries": [
            "England school exclusion attendance parental responsibility GOV.UK Citizens Advice",
            "England university student complaint OIA disciplinary GOV.UK",
        ],
    },
    "unclassified": {
        "topicKey": "area-common-unclassified",
        "layKeywords": [
            "legal aid",
            "take a child abroad",
            "parental responsibility",
            "deed poll",
            "power of attorney",
            "small claims",
            "letter before action",
            "defamation",
            "privacy",
        ],
        "queries": [
            "England parental responsibility take child abroad consent GOV.UK",
            "England legal aid what you can get small claims letter before action GOV.UK Citizens Advice",
            "England lasting power of attorney deed poll change name GOV.UK",
        ],
    },
    "privacy": {
        "topicKey": "area-data-identity-privacy",
        "layKeywords": [
            "gdpr",
            "data protection",
            "subject access request",
            "identity theft",
            "ico",
            "personal data",
        ],
        "queries": [
            "England GDPR subject access request ICO data protection Citizens Advice",
        ],
    },
    "immigration": {
        "topicKey": "area-immigration-visas",
        "layKeywords": [
            "visa",
            "home office",
            "immigration",
            "leave to remain",
            "passport",
        ],
        "queries": [
            "England visa immigration Home Office leave to remain GOV.UK",
        ],
    },
    "benefits": {
        "topicKey": "area-benefits-council-tax",
        "layKeywords": [
            "council tax",
            "universal credit",
            "benefits",
            "dwp",
            "pip",
        ],
        "queries": [
            "England council tax summons universal credit Citizens Advice GOV.UK",
        ],
    },
    "medical": {
        "topicKey": "area-medical-clinical-nhs",
        "layKeywords": [
            "nhs",
            "hospital",
            "clinical negligence",
            "nhs complaints",
            "complain about nhs",
            "medical",
            "dentist",
            "gp",
            "medication",
        ],
        "queries": [
            "England NHS complaints clinical negligence how to complain hospital GOV.UK Citizens Advice NHS.uk",
            "England dental NHS referral complaint medical negligence Citizens Advice",
        ],
    },
    "conveyancing": {
        "topicKey": "area-conveyancing-property-sale",
        "layKeywords": [
            "conveyancing",
            "buying a home",
            "selling a home",
            "exchange of contracts",
            "completion",
            "surveyor",
            "buyer",
            "seller",
        ],
        "queries": [
            "England buying selling home conveyancing exchange completion GOV.UK Citizens Advice",
            "England conveyancing solicitor problems buyer seller survey Citizens Advice",
        ],
    },
    "pets": {
        "topicKey": "area-pets-animals",
        "layKeywords": [
            "pet",
            "dog",
            "cat",
            "animal",
            "rspca",
            "animal welfare",
            "dangerous dogs",
            "vet",
            "animal bite",
        ],
        "queries": [
            "England dog bite dangerous dogs Act animal welfare RSPCA GOV.UK Citizens Advice",
            "England pet neighbour dispute animal cruelty report RSPCA GOV.UK",
        ],
    },
    "ip": {
        "topicKey": "area-ip-copyright",
        "layKeywords": [
            "copyright",
            "trade mark",
            "trademark",
            "intellectual property",
            "ipo",
            "patent",
            "brand",
        ],
        "queries": [
            "England copyright infringement trade mark IPO GOV.UK Citizens Advice",
            "England using copyrighted material music video fair dealing IPO",
        ],
    },
    "travel": {
        "topicKey": "area-travel-flights-holidays",
        "layKeywords": [
            "flight",
            "airline",
            "air passenger",
            "luggage",
            "package holiday",
            "caa",
            "flight delay",
            "airport",
            "denied boarding",
        ],
        "queries": [
            "England air passenger rights flight delay cancellation luggage CAA GOV.UK Citizens Advice",
            "England package holiday ATOL claim airline compensation Citizens Advice",
        ],
    },
    "cctv": {
        "topicKey": "area-cctv-recording-privacy",
        "layKeywords": [
            "cctv",
            "nanny cam",
            "recording",
            "covert",
            "privacy",
            "home camera",
            "surveillance",
            "ico",
            "data protection",
        ],
        "queries": [
            "England CCTV camera own home nanny cam recording privacy ICO GOV.UK",
            "England domestic CCTV neighbours data protection ICO Citizens Advice",
        ],
    },
    "crimpro": {
        "topicKey": "area-criminal-procedure",
        "layKeywords": [
            "bail",
            "bail conditions",
            "court summons",
            "crown court",
            "magistrates",
            "plea",
            "sentence",
            "suspended sentence",
            "caution",
            "nfa",
            "disclosure",
            "defendant",
            "breach",
            "cps",
            "citizens arrest",
        ],
        "queries": [
            "England bail conditions court summons crown court magistrates CPS GOV.UK Citizens Advice",
            "England police caution NFA what happens next breach bail GOV.UK CPS",
        ],
    },
    "devolved": {
        "topicKey": "area-devolved-scotland-ni-wales",
        "layKeywords": [
            "scotland",
            "scottish",
            "northern ireland",
            "wales",
            "welsh",
            "citizens advice scotland",
            "mygov",
            "nidirect",
        ],
        "queries": [
            "Scotland Citizens Advice consumer employment housing rights mygov.scot cas.org.uk",
            "Northern Ireland nidirect legal rights housing employment consumer Citizens Advice",
            "Wales gov.wales Citizens Advice consumer housing employment rights",
        ],
    },
    "leasehold": {
        "topicKey": "area-leasehold-service-charge",
        "layKeywords": [
            "leasehold",
            "service charge",
            "ground rent",
            "leaseholder",
            "freeholder",
            "housing ombudsman",
            "major works",
            "service charge increase",
        ],
        "queries": [
            "England leasehold service charge ground rent LEASE advice GOV.UK Citizens Advice",
            "England challenge service charge increase housing ombudsman leaseholder rights",
        ],
    },
    "sra": {
        "topicKey": "area-sra-legal-ombudsman",
        "layKeywords": [
            "solicitor",
            "barrister",
            "legal ombudsman",
            "sra",
            "complain about solicitor",
            "solicitor negligence",
            "lawyer complaint",
            "character and suitability",
        ],
        "queries": [
            "England complain about solicitor Legal Ombudsman SRA Citizens Advice GOV.UK",
            "England solicitor negligence Legal Ombudsman how to complain SRA",
        ],
    },
    "energy": {
        "topicKey": "area-energy-broadband-complaints",
        "layKeywords": [
            "energy bill",
            "ofgem",
            "ofcom",
            "broadband",
            "energy supplier",
            "smart meter",
            "telecoms",
            "bt",
            "water company",
            "energy ombudsman",
        ],
        "queries": [
            "England energy bill complaint Ofgem energy ombudsman Citizens Advice GOV.UK",
            "England broadband complaint Ofcom telecoms provider Citizens Advice",
        ],
    },
}


def enrich_area_pages(topic_key: str, lay_keywords: list[str]) -> int:
    """After Exa index, widen keywords/requireAny so lay empties can match."""
    idx = load_index()
    topic = (idx.get("topics") or {}).get(topic_key) or {}
    page_ids = set(topic.get("pageIds") or [])
    if not page_ids:
        return 0
    n = 0
    for page in idx.get("pages") or []:
        if page.get("id") not in page_ids:
            continue
        kws = list(page.get("keywords") or [])
        seen = {k.lower() for k in kws}
        for k in lay_keywords:
            if k.lower() not in seen:
                kws.append(k)
                seen.add(k.lower())
        page["keywords"] = kws[:50]
        # Prefer lay phrases + single strong tokens so posts can match
        multi = [k for k in lay_keywords if " " in k]
        single = [k for k in lay_keywords if " " not in k]
        req = (multi[:4] + single[:6])[:12]
        for r in page.get("requireAny") or []:
            if r not in req and len(req) < 12:
                req.append(r)
        page["requireAny"] = req
        page["areaFill"] = True
        n += 1
    save_index(idx)
    return n


def main() -> None:
    parser = argparse.ArgumentParser(description="Curated per-area Exa fill (credit-light).")
    parser.add_argument(
        "--areas",
        default="crime,probate,housing,consumer,employment,motoring,debt,business,neighbour,family,education,unclassified,privacy,immigration,benefits",
        help="Comma-separated area ids",
    )
    parser.add_argument("--num", type=int, default=8, help="Exa results per query")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    wanted = [a.strip() for a in args.areas.split(",") if a.strip()]
    summary = []
    total_calls = 0

    print(
        f"Area fill → {INDEX_PATH.name} (skip if topic already indexed unless --force)",
        file=sys.stderr,
    )

    for area_id in wanted:
        conf = AREA_HUNTS.get(area_id)
        if not conf:
            print(f"Unknown area `{area_id}` — skip", file=sys.stderr)
            continue
        topic_key = conf["topicKey"]
        idx = load_index()
        if topic_already_indexed(idx, topic_key) and not args.force:
            print(f"SKIP `{topic_key}` already indexed", file=sys.stderr)
            summary.append({"area": area_id, "topicKey": topic_key, "skipped": True})
            enrich_area_pages(topic_key, conf["layKeywords"])
            continue

        area_rows = []
        for q in conf["queries"]:
            if args.dry_run:
                print(f"DRY {topic_key}: {q[:100]}…", file=sys.stderr)
                area_rows.append({"dryRun": True, "query": q})
                continue
            rec = process_one(
                query=q,
                topic_key=topic_key,
                num=args.num,
                dry_run=False,
                force=True,  # same topicKey, multiple queries merge pages
            )
            if rec.get("exaCalled"):
                total_calls += 1
            area_rows.append(rec)

        enriched = 0
        if not args.dry_run:
            enriched = enrich_area_pages(topic_key, conf["layKeywords"])
        summary.append(
            {
                "area": area_id,
                "topicKey": topic_key,
                "queries": len(conf["queries"]),
                "exaCalls": sum(1 for r in area_rows if r.get("exaCalled")),
                "pagesEnriched": enriched,
                "rows": area_rows,
            }
        )

    print(
        json.dumps(
            {"exaCallsTotal": total_calls, "areas": summary},
            indent=2,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
