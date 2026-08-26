#!/usr/bin/env python3
"""Exa hunt: UK free/national signposting orgs for Legal Shaman signpost sections."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[3]  # R&D
ENV = ROOT / "LS R&D" / ".env"
SIGNPOST = ROOT / "Legal_Shaman-vnext" / "web" / "data" / "signposting-resources.json"
OUT = ROOT / "Legal_Shaman-vnext" / "web" / "data" / "signposting-exa-candidates.json"

# Prefer thinner / gap sections; still cover all
SECTION_QUERIES: dict[str, list[str]] = {
    "Neighbours and Property": [
        "UK free advice neighbour dispute boundary fence noise nuisance Citizens Advice GOV.UK",
        "England party wall disputes mediation neighbour mediation service charity",
    ],
    "Health and Injury": [
        "UK free advice personal injury clinical negligence NHS complaints advocacy AvMA Citizens Advice",
        "England workplace injury RIDDOR HSE advice free legal help industrial disease",
    ],
    "Education": [
        "UK free advice SEND education special educational needs IPSEA Coram school exclusion appeal",
        "England school admissions appeal free advice ACE Education Advice",
    ],
    "Wills and Planning Ahead": [
        "UK free advice wills probate lasting power of attorney Age UK Citizens Advice GOV.UK",
        "England inheritance dispute free advice probate clinic charity",
    ],
    "Consumer Rights": [
        "UK free consumer rights advice Citizens Advice Which Resolver ombudsman goods services",
        "England motor ombudsman used car reject refund free advice Consumer Rights Act",
    ],
    "Your Business": [
        "UK free advice small business legal help LawWorks ACAS IP intellectual property GOV.UK",
        "England freelance self-employed employment rights free advice Citizens Advice",
    ],
    "Immigration and Citizenship": [
        "UK free immigration advice OISC regulated charity Refugee Council JCWI Rights of Women",
        "England asylum support free legal advice Bail for Immigration Detainees",
    ],
    "Driving and Parking": [
        "UK free advice parking ticket PCN appeal POPLA Traffic Penalty Tribunal Citizens Advice",
        "England DVLA driving licence endorsement free advice motoring law charity",
    ],
    "Home and Housing": [
        "UK free housing advice Shelter Crisis Generation Rent deposit protection free legal clinic",
        "England disrepair mould free advice housing ombudsman tenants union",
    ],
    "Work and Employment": [
        "UK free employment advice ACAS Working Families Maternity Action GMB Unite free legal clinic",
        "England unfair dismissal free representation FRU employment tribunal advice",
    ],
    "Money, Benefits and Debt": [
        "UK free debt advice StepChange National Debtline MoneyHelper Turn2us benefits",
        "England welfare benefits appeal free advice CPAG Citizens Advice",
    ],
    "Rights and Discrimination": [
        "UK free discrimination advice Equality Advisory Support Service EHRC Disability Law Service",
        "England hate crime discrimination free advice Liberty Runnymede",
    ],
    "Crime and Police": [
        "UK free advice victims of crime Victim Support Witness Service IOPC complaint",
        "England criminal appeal free advice APPEAL miscarriage of justice",
    ],
    "Courts and Disputes": [
        "UK free advice small claims mediation AdviceNow Support Through Court Litigants in Person",
        "England civil court fee remission help with fees GOV.UK",
    ],
    "Family and Relationships": [
        "UK free family law advice Rights of Women Resolution mediation Family Rights Group",
        "England domestic abuse free legal advice National Domestic Abuse Helpline Rights of Women",
    ],
    "Getting Help": [
        "UK find free legal advice Law Centres Network AdviceUK Access to Justice Foundation",
        "England solicitor free initial advice Law Society Find a Solicitor pro bono",
    ],
}

BLOCK_HOSTS = {
    "youtube.com",
    "youtu.be",
    "facebook.com",
    "twitter.com",
    "x.com",
    "linkedin.com",
    "instagram.com",
    "tiktok.com",
    "pinterest.com",
    "amazon.co.uk",
    "ebay.co.uk",
}


def load_key() -> str:
    raw = os.environ.get("EXA_API_KEY", "").strip()
    if raw:
        return raw
    if ENV.exists():
        for line in ENV.read_text().splitlines():
            if line.startswith("EXA_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("EXA_API_KEY missing")


def host(url: str) -> str:
    try:
        h = urlparse(url).netloc.lower()
        return h[4:] if h.startswith("www.") else h
    except Exception:
        return ""


def existing_urls_and_names(data: dict) -> tuple[set[str], set[str]]:
    urls: set[str] = set()
    names: set[str] = set()
    for sec in data["sections"]:
        for r in sec["resources"]:
            if r.get("url"):
                urls.add(r["url"].rstrip("/").lower())
            names.add(re.sub(r"\s+", " ", (r.get("name") or "").lower()).strip())
            for link in r.get("links") or []:
                if link.get("url"):
                    urls.add(link["url"].rstrip("/").lower())
    return urls, names


def main() -> None:
    from exa_py import Exa

    key = load_key()
    exa = Exa(api_key=key)
    data = json.loads(SIGNPOST.read_text())
    have_urls, have_names = existing_urls_and_names(data)

    results: dict[str, list[dict]] = {}
    for section, queries in SECTION_QUERIES.items():
        print(f"\n=== {section} ===", flush=True)
        seen_hosts: set[str] = set()
        picks: list[dict] = []
        for q in queries:
            try:
                resp = exa.search_and_contents(
                    q,
                    type="auto",
                    num_results=6,
                    text={"max_characters": 600},
                    livecrawl="fallback",
                )
            except Exception as e:
                print(f"  ERR {e}", flush=True)
                continue
            for r in resp.results:
                url = (r.url or "").strip()
                title = (r.title or "").strip()
                if not url or not title:
                    continue
                h = host(url)
                if not h or h in BLOCK_HOSTS:
                    continue
                if any(x in h for x in ("solicitor", "lawfirm", "chambers")) and "gov.uk" not in h:
                    # keep charities/gov; skip obvious firm marketing
                    if not any(
                        k in (title + " " + (r.text or "")).lower()
                        for k in ("free", "charity", "advice", "helpline", "ombudsman")
                    ):
                        continue
                ukey = url.rstrip("/").lower()
                nkey = re.sub(r"\s+", " ", title.lower()).strip()
                if ukey in have_urls or nkey in have_names:
                    continue
                if h in seen_hosts:
                    continue
                text = (r.text or "").strip().replace("\n", " ")
                desc = text[:220].rsplit(" ", 1)[0] + ("…" if len(text) > 220 else "")
                pick = {
                    "name": title[:120],
                    "description": desc,
                    "url": url,
                    "sourceQuery": q,
                    "host": h,
                }
                picks.append(pick)
                seen_hosts.add(h)
                have_urls.add(ukey)
                have_names.add(nkey)
                print(f"  + {title[:70]} | {h}", flush=True)
                if len(picks) >= 4:
                    break
            if len(picks) >= 4:
                break
        results[section] = picks

    OUT.write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n")
    print(f"\nWrote {OUT}", flush=True)
    total = sum(len(v) for v in results.values())
    print(f"Candidates: {total}", flush=True)


if __name__ == "__main__":
    main()
