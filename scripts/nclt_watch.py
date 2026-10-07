#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import io
import os
import re
import sys
import time
from datetime import date
from urllib.parse import quote, urljoin

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader

DESK_URL = os.environ.get('MATTER_DESK_URL', '').rstrip('/')
SECRET = os.environ.get('NCLT_WATCH_SECRET', '')
NCLT_DETAILS = 'https://efiling.nclt.gov.in/nclt/public/details.php'
CAUSE_LIST = 'https://nclt.gov.in/all-cause-list'
UA = 'MatterDesk-NCLT-Watch/2.0 (public tribunal monitoring; low-frequency; reliability-audited)'
CAUSE_PAGES = max(2, min(int(os.environ.get('NCLT_CAUSE_PAGES', '8')), 20))
MAX_UNSCOPED_DOCS = max(20, min(int(os.environ.get('NCLT_MAX_UNSCOPED_DOCS', '60')), 120))

IA_PATTERNS = [
    re.compile(
        r'\b(?:NEW\s+)?I\s*\.?\s*A\s*\.?\s*(?:\([^)]*\)\s*)*(?:NO\.?\s*)?[/\-]?\s*'
        r'(\d{1,6})\s*(?:(?:\([^)]*\)\s*)+(?:/|\bOF\b)?|/|\bOF\b|\s+)\s*(\d{4})\b',
        re.I,
    ),
]

URL_RE = re.compile(r'https?://[^\s<>()\]\[\"\']+', re.I)
VC_HINTS = ('webex.com', 'teams.microsoft.com', 'meet.google.com', 'zoom.us')


BENCH_ALIASES = {
    'mumbai': ['mumbai'], 'kolkata': ['kolkata'], 'newdelhi': ['new delhi', 'principal bench'],
    'delhi': ['new delhi', 'principal bench'], 'chennai': ['chennai'],
    'bengaluru': ['bengaluru', 'bangalore'], 'bangalore': ['bengaluru', 'bangalore'],
    'hyderabad': ['hyderabad'], 'ahmedabad': ['ahmedabad'], 'allahabad': ['allahabad'],
    'chandigarh': ['chandigarh'], 'cuttack': ['cuttack'], 'guwahati': ['guwahati'],
    'jaipur': ['jaipur'], 'kochi': ['kochi'], 'amaravati': ['amaravati', 'amravati'],
    'amravati': ['amaravati', 'amravati'], 'indore': ['indore'],
}

BENCH_CODES = [
    (re.compile(r'\b(?:MB|MUM)\b|\(MB\)', re.I), 'mumbai'),
    (re.compile(r'\b(?:ND|NEW\s*DELHI)\b|\(ND\)|\(PB\)', re.I), 'newdelhi'),
    (re.compile(r'\b(?:KOL|KOLKATA)\b|\(KOL\)', re.I), 'kolkata'),
    (re.compile(r'\b(?:HYD|HYDERABAD)\b|\(HYD\)', re.I), 'hyderabad'),
    (re.compile(r'\b(?:AHM|AHMEDABAD)\b|\(AHM\)', re.I), 'ahmedabad'),
    (re.compile(r'\b(?:CHD|CHANDIGARH)\b|\(CHD\)', re.I), 'chandigarh'),
    (re.compile(r'\b(?:IND|INDORE)\b|\(IND\)', re.I), 'indore'),
    (re.compile(r'\b(?:JPR|JAIPUR)\b|\(JPR\)', re.I), 'jaipur'),
    (re.compile(r'\b(?:CHE|CHENNAI)\b|\(CHE\)', re.I), 'chennai'),
    (re.compile(r'\b(?:BLR|BENGALURU|BANGALORE)\b|\(BLR\)', re.I), 'bengaluru'),
]

STOPWORDS = {'PRIVATE','LIMITED','LTD','PVT','LLP','COMPANY','INDIA','VERSUS','VS','AND','THE','OF','IN'}


def norm_ia(value: str) -> str:
    return re.sub(r'[^A-Z0-9]', '', (value or '').upper())


def extract_ia_labels(text: str) -> list[str]:
    out, seen = [], set()
    for pattern in IA_PATTERNS:
        for m in pattern.finditer(text or ''):
            label = f'IA {int(m.group(1))}/{m.group(2)}'
            key = norm_ia(label)
            if key not in seen:
                seen.add(key); out.append(label)
    return out


def parse_iso_from_dmy(value: str | None) -> str | None:
    if not value:
        return None
    m = re.search(r'\b(\d{2})/(\d{2})/(\d{4})\b', value)
    if not m:
        return None
    try:
        d, mo, y = map(int, m.groups()); return date(y, mo, d).isoformat()
    except ValueError:
        return None


def request_with_retry(session: requests.Session, url: str, *, params=None, timeout=30, attempts=4) -> requests.Response:
    last = None
    for attempt in range(attempts):
        try:
            r = session.get(url, params=params, timeout=timeout)
            r.raise_for_status()
            if not r.content:
                raise RuntimeError('empty upstream response')
            return r
        except Exception as e:
            last = e
            if attempt + 1 < attempts:
                time.sleep(1.5 * (2 ** attempt))
    raise last


def pdf_or_html_payload(resp: requests.Response, max_pdf_pages: int = 15) -> dict:
    content = resp.content
    ctype = (resp.headers.get('content-type') or '').lower()
    links: list[str] = []
    text = ''
    if content.startswith(b'%PDF') or 'application/pdf' in ctype:
        try:
            reader = PdfReader(io.BytesIO(content))
            parts = []
            for page in reader.pages[:max_pdf_pages]:
                parts.append(page.extract_text() or '')
                try:
                    annots = page.get('/Annots') or []
                    for ref in annots:
                        obj = ref.get_object()
                        action = obj.get('/A') if obj else None
                        uri = action.get('/URI') if action else None
                        if uri:
                            links.append(str(uri))
                except Exception:
                    pass
            text = '\n'.join(parts)
        except Exception:
            text = ''
    else:
        try:
            soup = BeautifulSoup(resp.text, 'html.parser')
            text = soup.get_text(' ', strip=True)
            links.extend(a.get('href') for a in soup.find_all('a', href=True))
        except Exception:
            text = ''
    links.extend(URL_RE.findall(text or ''))
    clean_links, seen = [], set()
    for url in links:
        url = (url or '').strip().rstrip('.,;:)')
        if not url or url in seen:
            continue
        seen.add(url); clean_links.append(url)
    return {'text': text, 'links': clean_links}


def pdf_or_html_text(resp: requests.Response, max_pdf_pages: int = 15) -> str:
    return pdf_or_html_payload(resp, max_pdf_pages=max_pdf_pages)['text']


def extract_vc_url(text: str, links: list[str] | None = None) -> str | None:
    candidates = list(links or []) + URL_RE.findall(text or '')
    for url in candidates:
        low = (url or '').lower()
        if any(h in low for h in VC_HINTS):
            return url.strip().rstrip('.,;:)')
    m = re.search(r'VC\s*Link\s*[:\-]?\s*(https?://\S+)', text or '', re.I)
    return m.group(1).rstrip('.,;:)') if m else None

def matter_case_signature(case_number: str) -> tuple[str | None, str | None]:
    s = case_number or ''
    years = re.findall(r'\b(20\d{2})\b', s)
    year = years[-1] if years else None
    nums = re.findall(r'\b(\d{1,7})\b', s)
    nums = [n for n in nums if n != year]
    return (nums[-1] if nums else None), year


def infer_bench_slug(case_number: str) -> str | None:
    s = case_number or ''
    for pattern, slug in BENCH_CODES:
        if pattern.search(s):
            return slug
    return None


def distinctive_tokens(value: str) -> list[str]:
    toks = re.findall(r'[A-Z0-9]{3,}', (value or '').upper())
    return [t for t in toks if t not in STOPWORDS and not t.isdigit()]


def identity_matches(page_text: str, cfg: dict) -> bool:
    text = re.sub(r'\s+', ' ', page_text or '').upper()
    number, year = matter_case_signature(cfg.get('case_number') or '')
    if number and year and re.search(rf'\b{re.escape(number)}\b', text) and year in text:
        return True
    tokens = distinctive_tokens(cfg.get('cause_title') or cfg.get('short_name') or '')
    if len(tokens) >= 2 and sum(1 for t in tokens[:6] if t in text) >= 2:
        return True
    return False


def case_windows(text: str, case_number: str) -> list[str]:
    number, year = matter_case_signature(case_number)
    if not number or not year:
        return []
    wins = []
    patterns = [
        re.compile(rf'(?is)C\s*\.?\s*P\s*\.?[^\n]{{0,120}}?\b{re.escape(number)}\b[^\n]{{0,120}}?\b{re.escape(year)}\b'),
        re.compile(rf'(?is)\b{re.escape(number)}\b.{{0,110}}?\b{re.escape(year)}\b'),
    ]
    for pat in patterns:
        for m in pat.finditer(text or ''):
            wins.append(text[max(0,m.start()-550):min(len(text),m.end()+850)])
        if wins:
            break
    return wins


def bench_matches(row_text: str, slug: str) -> bool:
    slug = (slug or '').strip().lower()
    if not slug:
        return True
    aliases = BENCH_ALIASES.get(slug, [slug.replace('_',' ').replace('-',' ')])
    rt = (row_text or '').lower()
    return any(x in rt for x in aliases)


def bench_slug_from_row(row_text: str) -> str | None:
    low = (row_text or '').lower()
    for slug, aliases in BENCH_ALIASES.items():
        if slug == 'delhi':
            continue
        if any(a in low for a in aliases):
            return 'newdelhi' if slug == 'delhi' else slug
    return None


def fetch_details(session: requests.Session, cfg: dict) -> dict:
    filing = (cfg.get('nclt_filing_no') or '').strip()
    slug = (cfg.get('nclt_bench_slug') or infer_bench_slug(cfg.get('case_number') or '') or '').strip().lower()
    result = {
        'apps': [], 'orders': [], 'next_listing': None, 'errors': [], 'url': None,
        'status': 'unconfigured', 'identity_verified': False,
    }
    if not filing or not slug:
        return result
    token = base64.b64encode(f'{filing}/{slug}'.encode()).decode()
    url = f'{NCLT_DETAILS}?filing_no={quote(token, safe="")}'
    result['url'] = url
    try:
        r = request_with_retry(session, url, timeout=30)
    except Exception as e:
        result['status'] = 'failed'; result['errors'].append(f'case-status fetch: {type(e).__name__}: {e}')
        return result
    soup = BeautifulSoup(r.text, 'html.parser')
    page_text = soup.get_text(' ', strip=True)
    if len(page_text) < 100:
        result['status'] = 'failed'; result['errors'].append('case-status page returned too little text')
        return result
    if not identity_matches(page_text, cfg):
        result['status'] = 'identity_mismatch'
        result['errors'].append('filing/diary source did not match configured case identity')
        return result
    result['identity_verified'] = True
    result['status'] = 'success'
    m = re.search(r'Listing\s+Date\s+(\d{2}/\d{2}/\d{4})', page_text, re.I)
    result['next_listing'] = parse_iso_from_dmy(m.group(1) if m else None)
    known_urls = set(cfg.get('known_order_urls') or [])
    seen_urls = set()
    for tr in soup.find_all('tr'):
        row_text = ' '.join(tr.stripped_strings)
        for label in extract_ia_labels(row_text):
            result['apps'].append({
                'ia_number': label, 'title': 'Detected from NCLT case history',
                'notes': 'Automatically detected from NCLT public case history.',
                'source_reference': url, 'official_url': url,
            })
    candidates = []
    for tr in soup.find_all('tr'):
        links = [a for a in tr.find_all('a', href=True) if 'ordersview.drt' in (a.get('href') or '')]
        if not links:
            continue
        row_text = ' '.join(tr.stripped_strings)
        row_date = parse_iso_from_dmy(row_text)
        row_ias = extract_ia_labels(row_text)
        for a in links:
            order_url = urljoin(url, a.get('href'))
            if order_url in seen_urls:
                continue
            seen_urls.add(order_url)
            candidates.append({'order_date':row_date,'row_text':row_text,'row_ias':row_ias,
                               'source_url':order_url,'title':' '.join(a.stripped_strings) or 'NCLT Order'})
    unknown = [x for x in candidates if x['source_url'] not in known_urls]
    unknown.sort(key=lambda x: (x.get('order_date') or '', x['source_url']), reverse=True)
    for item in unknown[:30]:
        order_url = item['source_url']; ia_labels = list(item.get('row_ias') or [])
        try:
            rr = request_with_retry(session, order_url, timeout=35)
            order_text = pdf_or_html_text(rr)
            parsed = extract_ia_labels(order_text)
            if parsed:
                ia_labels = parsed
            for label in ia_labels:
                result['apps'].append({'ia_number':label,'title':'Detected from NCLT order',
                                       'source_reference':order_url,'official_url':order_url})
        except Exception as e:
            result['errors'].append(f'order fetch {item.get("order_date") or ""}: {type(e).__name__}: {e}')
        result['orders'].append({
            'order_date': item.get('order_date'), 'order_type': item.get('title'), 'title': item.get('title'),
            'source_url': order_url, 'fingerprint': hashlib.sha256(order_url.encode()).hexdigest(),
            'ia_numbers': ia_labels,
        })
    return result


def discover_cause_docs(session: requests.Session) -> dict:
    docs, errors, seen = [], [], set()
    targets = [(CAUSE_LIST, None)] + [(CAUSE_LIST, {'page': page}) for page in range(0, CAUSE_PAGES)]
    successful_pages = 0
    for url, params in targets:
        try:
            r = request_with_retry(session, url, params=params, timeout=30)
            soup = BeautifulSoup(r.text, 'html.parser')
            page_docs = 0
            for tr in soup.find_all('tr'):
                row_text = ' '.join(tr.stripped_strings)
                for a in tr.find_all('a', href=True):
                    href = a.get('href') or ''; full = urljoin(r.url, href); low = full.lower()
                    if '.pdf' not in low and 'pdf_cause_list' not in low and '/sites/default/files/' not in low:
                        continue
                    if full in seen:
                        continue
                    seen.add(full); docs.append({'url':full,'row_text':row_text,'cause_date':parse_iso_from_dmy(row_text)}); page_docs += 1
            if page_docs:
                successful_pages += 1
        except Exception as e:
            errors.append(f'cause-list page {params}: {type(e).__name__}: {e}')
    status = 'success' if successful_pages and len(docs) >= 5 else 'failed'
    if status == 'failed' and not errors:
        errors.append(f'cause-list discovery returned only {len(docs)} documents')
    return {'docs':docs,'errors':errors,'status':status,'successful_pages':successful_pages}


def scan_cause_docs(session: requests.Session, cfg: dict, docs: list[dict], cache: dict[str,dict]) -> dict:
    apps, errors, matches = [], [], []
    slug = (cfg.get('nclt_bench_slug') or infer_bench_slug(cfg.get('case_number') or '') or '').strip().lower()
    case_number = cfg.get('case_number') or ''
    if not case_number:
        return {'apps':apps,'errors':['main case number missing; cause-list matching unavailable'],
                'status':'unconfigured','docs_scanned':0,'detected_bench_slug':None,'matches':[]}
    relevant = [d for d in docs if bench_matches(d.get('row_text',''), slug)] if slug else list(docs)
    if not slug:
        relevant = relevant[:MAX_UNSCOPED_DOCS]
    docs_scanned = 0; detected_slug = None
    for doc in relevant:
        url = doc['url']
        try:
            if url not in cache:
                rr = request_with_retry(session, url, timeout=35)
                cache[url] = pdf_or_html_payload(rr, max_pdf_pages=50)
            payload = cache[url]; text = payload['text']; docs_scanned += 1
            wins = case_windows(text, case_number)
            if not wins:
                continue
            if not detected_slug:
                detected_slug = bench_slug_from_row(doc.get('row_text',''))
            vc_url = extract_vc_url(text, payload.get('links'))
            match = {
                'cause_list_url': url,
                'vc_url': vc_url,
                'cause_list_date': doc.get('cause_date'),
                'row_text': doc.get('row_text',''),
            }
            matches.append(match)
            for w in wins:
                for label in extract_ia_labels(w):
                    apps.append({
                        'ia_number':label,'title':'Detected from NCLT cause list',
                        'notes':'Automatically detected when publicly listed by NCLT.',
                        'source_reference':url,'official_url':url,
                        'cause_list_url':url,'vc_url':vc_url,'cause_list_date':doc.get('cause_date'),
                    })
        except Exception as e:
            errors.append(f'cause-list document {url}: {type(e).__name__}: {e}')
    status = 'success' if docs_scanned > 0 else 'failed'
    return {'apps':apps,'errors':errors,'status':status,'docs_scanned':docs_scanned,
            'detected_bench_slug':detected_slug,'matches':matches}

def dedupe_apps(items: list[dict]) -> list[dict]:
    out, seen = [], set()
    for x in items:
        key = norm_ia(x.get('ia_number',''))
        if not key or key in seen: continue
        seen.add(key); out.append(x)
    return out


def api_get(session: requests.Session, path: str) -> dict:
    r = session.get(f'{DESK_URL}{path}', headers={'x-nclt-watch-secret':SECRET}, timeout=30)
    r.raise_for_status(); return r.json()


def api_post(session: requests.Session, path: str, payload: dict) -> dict:
    r = session.post(f'{DESK_URL}{path}', headers={'x-nclt-watch-secret':SECRET}, json=payload, timeout=45)
    r.raise_for_status(); return r.json()


def self_test() -> None:
    fixture = 'Item 16 C.P.(IB)922/MB/2022 NEW IA(I.B.C)/2984 (MB)2026 IA No.701/2025 IA (I.B.C) 1324 (MB)/2026 IA(IBC)(PLAN) 35(MB)/2026'
    got = extract_ia_labels(fixture)
    assert {'IA 2984/2026','IA 701/2025','IA 1324/2026','IA 35/2026'}.issubset(set(got))
    assert case_windows(fixture,'CP IB 922 of 2022')
    assert infer_bench_slug('C.P.(IB)/922(MB)/2022') == 'mumbai'
    assert identity_matches('C.P.(IB)/922(MB)/2022 Ruby Mills Private Limited',
                            {'case_number':'CP IB 922 of 2022','cause_title':'Ruby Mills Private Limited'})
    assert extract_vc_url('Cisco WebEx VC Link https://ncltmum.webex.com/meet/ncltmum1', []) == 'https://ncltmum.webex.com/meet/ncltmum1'
    assert parse_iso_from_dmy('Cause List 09/10/2026 Mumbai Bench Court-I') == '2026-10-09'
    print('NCLT watcher reliability self-test passed')


def main() -> int:
    if '--self-test' in sys.argv:
        self_test(); return 0
    if not DESK_URL or not SECRET:
        print('MATTER_DESK_URL and NCLT_WATCH_SECRET are required', file=sys.stderr); return 2
    session = requests.Session(); session.headers.update({'User-Agent':UA,'Accept':'text/html,application/pdf;q=0.9,*/*;q=0.8','Cache-Control':'no-cache'})
    cfg = api_get(session,'/api/nclt/watch-config'); matters = cfg.get('matters') or []
    if not matters:
        print('No active NCLT matters currently require watch.'); return 0
    cause = discover_cause_docs(session); cause_cache: dict[str,dict] = {}
    total_apps = total_orders = ingest_failures = degraded = hard_failures = 0
    if cause['status'] != 'success':
        hard_failures += 1
    for m in matters:
        print(f"Checking matter {m['id']}: {m.get('short_name') or m.get('cause_title')}")
        details = fetch_details(session,m)
        cause_scan = scan_cause_docs(session,m,cause['docs'],cause_cache) if cause['status']=='success' else {
            'apps':[],'errors':['cause-list discovery failed'],'status':'failed','docs_scanned':0,'detected_bench_slug':None,'matches':[]}
        all_apps = dedupe_apps(details['apps'] + cause_scan['apps'])
        errors = list(cause.get('errors') or []) + list(details['errors']) + list(cause_scan['errors'])
        has_exact_config = bool((m.get('nclt_filing_no') or '').strip() and ((m.get('nclt_bench_slug') or '').strip() or infer_bench_slug(m.get('case_number') or '')))
        coverage = 'full' if has_exact_config and details['status']=='success' and cause_scan['status']=='success' else ('cause-list-only' if cause_scan['status']=='success' else 'degraded')
        if has_exact_config and details['status'] != 'success':
            hard_failures += 1
        if details['status'] not in {'success','unconfigured'} or cause_scan['status'] != 'success':
            degraded += 1
        preferred_dates = {d for d in (m.get('next_hearing_date'), m.get('nclt_next_listing_date')) if d}
        cause_matches = cause_scan.get('matches') or []
        exact_matches = [x for x in cause_matches if x.get('cause_list_date') in preferred_dates]
        cause_match = (exact_matches or cause_matches or [None])[0]
        payload = {
            'matter_id':m['id'], 'source_url':details['url'] or CAUSE_LIST,
            'applications':all_apps, 'orders':details['orders'], 'next_listing_date':details['next_listing'],
            'errors':errors[:30], 'detected_bench_slug':cause_scan.get('detected_bench_slug'),
            'cause_list':cause_match,
            'source_health':{
                'case_status':details['status'], 'cause_list':cause_scan['status'],
                'identity_verified':details['identity_verified'], 'coverage_level':coverage,
                'cause_docs_discovered':len(cause['docs']), 'cause_docs_scanned':cause_scan['docs_scanned'],
            },
        }
        try:
            result = api_post(session,'/api/nclt/ingest',payload)
            total_apps += int(result.get('new_applications') or 0); total_orders += int(result.get('new_orders') or 0)
            print(f"  coverage={coverage} case={details['status']} cause-list={cause_scan['status']} new IAs={result.get('new_applications',0)} new orders={result.get('new_orders',0)}")
        except Exception as e:
            ingest_failures += 1; hard_failures += 1; print(f'  ingest failed: {e}', file=sys.stderr)
        time.sleep(0.5)
    print(f'NCLT watch complete: {len(matters)} matters, {total_apps} new IAs, {total_orders} new orders, {degraded} degraded, {ingest_failures} ingest failures, {hard_failures} hard source failures')
    return 1 if hard_failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
