#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import io
import os
import re
import sys
import time
from datetime import date, timedelta
from urllib.parse import quote, urljoin

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader

DESK_URL = os.environ.get("MATTER_DESK_URL", "").rstrip("/")
SECRET = os.environ.get("NCLT_WATCH_SECRET", "")
NCLT_DETAILS = "https://efiling.nclt.gov.in/nclt/public/details.php"
CAUSE_LIST = "https://nclt.gov.in/all-cause-list"
UA = "MatterDesk-NCLT-Watch/1.0 (public tribunal monitoring; low-frequency)"

IA_PATTERNS = [
    re.compile(r"\bI\s*\.?\s*A\s*\.?\s*(?:\([^)]*\)\s*)*(?:NO\.?\s*)?[/\-]?\s*(\d{1,6})\s*(?:\([^)]*\)\s*)?(?:/|\bOF\b)\s*(\d{4})\b", re.I),
    re.compile(r"\bIA\s+(\d{1,6})\s+OF\s+(\d{4})\b", re.I),
]

BENCH_ALIASES = {
    "mumbai": ["mumbai"],
    "kolkata": ["kolkata"],
    "newdelhi": ["new delhi", "principal bench"],
    "delhi": ["new delhi", "principal bench"],
    "chennai": ["chennai"],
    "bengaluru": ["bengaluru", "bangalore"],
    "bangalore": ["bengaluru", "bangalore"],
    "hyderabad": ["hyderabad"],
    "ahmedabad": ["ahmedabad"],
    "allahabad": ["allahabad"],
    "chandigarh": ["chandigarh"],
    "cuttack": ["cuttack"],
    "guwahati": ["guwahati"],
    "jaipur": ["jaipur"],
    "kochi": ["kochi"],
    "amaravati": ["amaravati", "amravati"],
    "amravati": ["amaravati", "amravati"],
    "indore": ["indore"],
}


def norm_ia(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def extract_ia_labels(text: str) -> list[str]:
    out = []
    seen = set()
    text = text or ""
    for pattern in IA_PATTERNS:
        for m in pattern.finditer(text):
            label = f"IA {int(m.group(1))}/{m.group(2)}"
            key = norm_ia(label)
            if key not in seen:
                seen.add(key)
                out.append(label)
    return out


def parse_iso_from_dmy(value: str | None) -> str | None:
    if not value:
        return None
    m = re.search(r"\b(\d{2})/(\d{2})/(\d{4})\b", value)
    if not m:
        return None
    try:
        d, mo, y = map(int, m.groups())
        return date(y, mo, d).isoformat()
    except ValueError:
        return None


def pdf_or_html_text(resp: requests.Response, max_pdf_pages: int = 15) -> str:
    content = resp.content
    ctype = (resp.headers.get("content-type") or "").lower()
    if content.startswith(b"%PDF") or "application/pdf" in ctype:
        try:
            reader = PdfReader(io.BytesIO(content))
            return "\n".join((p.extract_text() or "") for p in reader.pages[:max_pdf_pages])
        except Exception:
            return ""
    try:
        return BeautifulSoup(resp.text, "html.parser").get_text(" ", strip=True)
    except Exception:
        return ""


def matter_case_signature(case_number: str) -> tuple[str | None, str | None]:
    s = case_number or ""
    years = re.findall(r"\b(20\d{2})\b", s)
    year = years[-1] if years else None
    nums = re.findall(r"\b(\d{1,7})\b", s)
    nums = [n for n in nums if n != year]
    number = nums[-1] if nums else None
    return number, year


def case_windows(text: str, case_number: str) -> list[str]:
    number, year = matter_case_signature(case_number)
    if not number or not year:
        return []
    wins = []
    patterns = [
        re.compile(rf"(?is)C\s*\.?\s*P\s*\.?[^\n]{{0,100}}?\b{re.escape(number)}\b[^\n]{{0,100}}?\b{re.escape(year)}\b"),
        re.compile(rf"(?is)\b{re.escape(number)}\b.{{0,90}}?\b{re.escape(year)}\b"),
    ]
    for pat in patterns:
        for m in pat.finditer(text or ""):
            a = max(0, m.start() - 450)
            b = min(len(text), m.end() + 650)
            wins.append(text[a:b])
        if wins:
            break
    return wins


def bench_matches(row_text: str, slug: str) -> bool:
    slug = (slug or "").strip().lower()
    if not slug:
        return True
    aliases = BENCH_ALIASES.get(slug, [slug.replace("_", " ").replace("-", " ")])
    rt = (row_text or "").lower()
    return any(x in rt for x in aliases)


def fetch_details(session: requests.Session, cfg: dict) -> tuple[list[dict], list[dict], str | None, list[str], str | None]:
    filing = (cfg.get("nclt_filing_no") or "").strip()
    slug = (cfg.get("nclt_bench_slug") or "").strip().lower()
    if not filing or not slug:
        return [], [], None, [], None

    token = base64.b64encode(f"{filing}/{slug}".encode()).decode()
    url = f"{NCLT_DETAILS}?filing_no={quote(token, safe='')}"
    errors: list[str] = []
    apps: list[dict] = []
    orders: list[dict] = []
    try:
        r = session.get(url, timeout=25)
        r.raise_for_status()
    except Exception as e:
        return [], [], None, [f"case-status fetch: {type(e).__name__}: {e}"], url

    soup = BeautifulSoup(r.text, "html.parser")
    page_text = soup.get_text(" ", strip=True)
    m = re.search(r"Listing\s+Date\s+(\d{2}/\d{2}/\d{4})", page_text, re.I)
    next_listing = parse_iso_from_dmy(m.group(1) if m else None)
    known_urls = set(cfg.get("known_order_urls") or [])
    seen_urls = set()

    # Backfill/public-diff the IA/Application set exposed on NCLT's case-details page.
    # On the first sync these are imported silently; later unseen labels become NEW alerts.
    for tr in soup.find_all("tr"):
        row_text = " ".join(tr.stripped_strings)
        labels = extract_ia_labels(row_text)
        for label in labels:
            apps.append({
                "ia_number": label,
                "title": "Detected from NCLT case history",
                "notes": "Automatically detected from NCLT public case history.",
                "source_reference": url,
                "official_url": url,
            })

    candidates = []
    for tr in soup.find_all("tr"):
        links = [a for a in tr.find_all("a", href=True) if "ordersview.drt" in (a.get("href") or "")]
        if not links:
            continue
        row_text = " ".join(tr.stripped_strings)
        row_date = parse_iso_from_dmy(row_text)
        row_ias = extract_ia_labels(row_text)
        for a in links:
            order_url = urljoin(url, a.get("href"))
            if order_url in seen_urls:
                continue
            seen_urls.add(order_url)
            candidates.append({
                "order_date": row_date,
                "row_text": row_text,
                "row_ias": row_ias,
                "source_url": order_url,
                "title": " ".join(a.stripped_strings) or "NCLT Order",
            })

    # Backfill is intentionally bounded so a very old matter cannot make a scheduled
    # run hang. Unknown orders are processed newest-first; the next run continues.
    unknown = [x for x in candidates if x["source_url"] not in known_urls]
    unknown.sort(key=lambda x: (x.get("order_date") or "", x["source_url"]), reverse=True)
    for item in unknown[:25]:
        order_url = item["source_url"]
        ia_labels = list(item.get("row_ias") or [])
        try:
            rr = session.get(order_url, timeout=30)
            rr.raise_for_status()
            order_text = pdf_or_html_text(rr)
            parsed = extract_ia_labels(order_text)
            if parsed:
                ia_labels = parsed
            for label in ia_labels:
                apps.append({
                    "ia_number": label,
                    "title": "Detected from NCLT order",
                    "source_reference": order_url,
                    "official_url": order_url,
                })
        except Exception as e:
            errors.append(f"order fetch {item.get('order_date') or ''}: {type(e).__name__}")
        orders.append({
            "order_date": item.get("order_date"),
            "order_type": item.get("title"),
            "title": item.get("title"),
            "source_url": order_url,
            "fingerprint": hashlib.sha256(order_url.encode()).hexdigest(),
            "ia_numbers": ia_labels,
        })

    return apps, orders, next_listing, errors, url


def discover_cause_docs(session: requests.Session) -> tuple[list[dict], list[str]]:
    docs: list[dict] = []
    errors: list[str] = []
    seen = set()
    # Recent pages are scanned instead of relying on fragile date-filter parameter formats.
    for page in range(0, 4):
        try:
            r = session.get(CAUSE_LIST, params={"page": page}, timeout=25)
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "html.parser")
            for tr in soup.find_all("tr"):
                row_text = " ".join(tr.stripped_strings)
                for a in tr.find_all("a", href=True):
                    href = a.get("href") or ""
                    full = urljoin(r.url, href)
                    low = full.lower()
                    if ".pdf" not in low and "pdf_cause_list" not in low and "/sites/default/files/" not in low:
                        continue
                    if full in seen:
                        continue
                    seen.add(full)
                    docs.append({"url": full, "row_text": row_text})
        except Exception as e:
            errors.append(f"cause-list page {page}: {type(e).__name__}: {e}")
    return docs, errors


def scan_cause_docs(session: requests.Session, cfg: dict, docs: list[dict], cache: dict[str, str]) -> tuple[list[dict], list[str]]:
    apps: list[dict] = []
    errors: list[str] = []
    slug = (cfg.get("nclt_bench_slug") or "").strip().lower()
    case_number = cfg.get("case_number") or ""
    if not case_number:
        return apps, errors

    relevant = [d for d in docs if bench_matches(d.get("row_text", ""), slug)]
    # Bound network work even if the NCLT listing page changes unexpectedly.
    relevant = relevant[:30]
    for doc in relevant:
        url = doc["url"]
        try:
            if url not in cache:
                rr = session.get(url, timeout=30)
                rr.raise_for_status()
                cache[url] = pdf_or_html_text(rr, max_pdf_pages=40)
            text = cache[url]
            wins = case_windows(text, case_number)
            for w in wins:
                labels = extract_ia_labels(w)
                for label in labels:
                    apps.append({
                        "ia_number": label,
                        "title": "Detected from NCLT cause list",
                        "notes": "Automatically detected when publicly listed by NCLT.",
                        "source_reference": url,
                        "official_url": url,
                    })
        except Exception as e:
            errors.append(f"cause-list document: {type(e).__name__}")
    return apps, errors


def dedupe_apps(items: list[dict]) -> list[dict]:
    out, seen = [], set()
    for x in items:
        key = norm_ia(x.get("ia_number", ""))
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(x)
    return out


def api_get(session: requests.Session, path: str) -> dict:
    r = session.get(f"{DESK_URL}{path}", headers={"x-nclt-watch-secret": SECRET}, timeout=25)
    r.raise_for_status()
    return r.json()


def api_post(session: requests.Session, path: str, payload: dict) -> dict:
    r = session.post(f"{DESK_URL}{path}", headers={"x-nclt-watch-secret": SECRET}, json=payload, timeout=40)
    r.raise_for_status()
    return r.json()


def self_test() -> None:
    fixture = """
    Item 16 C.P.(IB)922/MB/2022 IA 2984 of 2026 IA (I.B.C) 1324 (MB)/2026
    IA(IBC)(PLAN) 35(MB)/2026 IA No.701/2025
    """
    got = extract_ia_labels(fixture)
    assert "IA 2984/2026" in got
    assert "IA 1324/2026" in got
    assert "IA 35/2026" in got
    assert "IA 701/2025" in got
    wins = case_windows(fixture, "CP IB 922 of 2022")
    assert wins and "2984" in wins[0]
    print("NCLT watcher self-test passed")


def main() -> int:
    if "--self-test" in sys.argv:
        self_test()
        return 0
    if not DESK_URL or not SECRET:
        print("MATTER_DESK_URL and NCLT_WATCH_SECRET are required", file=sys.stderr)
        return 2

    session = requests.Session()
    session.headers.update({"User-Agent": UA, "Accept": "text/html,application/pdf;q=0.9,*/*;q=0.8"})
    cfg = api_get(session, "/api/nclt/watch-config")
    matters = cfg.get("matters") or []
    if not matters:
        print("No matters currently have NCLT Watch enabled.")
        return 0

    cause_docs, global_cause_errors = discover_cause_docs(session)
    cause_cache: dict[str, str] = {}
    total_apps = total_orders = 0
    failures = 0
    for m in matters:
        print(f"Checking matter {m['id']}: {m.get('short_name') or m.get('cause_title')}")
        all_apps: list[dict] = []
        all_orders: list[dict] = []
        errors = list(global_cause_errors)
        details_apps, orders, next_listing, detail_errors, source_url = fetch_details(session, m)
        all_apps.extend(details_apps)
        all_orders.extend(orders)
        errors.extend(detail_errors)
        cause_apps, cause_errors = scan_cause_docs(session, m, cause_docs, cause_cache)
        all_apps.extend(cause_apps)
        errors.extend(cause_errors)
        payload = {
            "matter_id": m["id"],
            "source_url": source_url or CAUSE_LIST,
            "applications": dedupe_apps(all_apps),
            "orders": all_orders,
            "next_listing_date": next_listing,
            "errors": errors[:20],
        }
        try:
            result = api_post(session, "/api/nclt/ingest", payload)
            total_apps += int(result.get("new_applications") or 0)
            total_orders += int(result.get("new_orders") or 0)
            print(f"  new IAs={result.get('new_applications',0)} new orders={result.get('new_orders',0)}")
        except Exception as e:
            failures += 1
            print(f"  ingest failed: {e}", file=sys.stderr)
        time.sleep(1)

    print(f"NCLT watch complete: {len(matters)} matters, {total_apps} new IAs, {total_orders} new orders, {failures} ingest failures")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
