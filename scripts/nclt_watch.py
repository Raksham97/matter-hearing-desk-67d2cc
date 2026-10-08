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
ORDER_BATCH_SIZE = max(4, min(int(os.environ.get('NCLT_ORDER_BATCH_SIZE', '12')), 20))

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


IA_KEY_RE = re.compile(
    r'I\s*\.?\s*A\s*\.?[^0-9]{0,40}(\d{1,6})[^0-9]{0,40}(\d{4})\b',
    re.I,
)

def norm_ia(value: str) -> str:
    text = value or ''
    m = IA_KEY_RE.search(text)
    if m:
        return f'IA{int(m.group(1))}{m.group(2)}'
    return re.sub(r'[^A-Z0-9]', '', text.upper())


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
    """Return conservative windows around an exact CP(IB) case-number match.

    Older logic fell back to searching only the bare number/year (for example
    `2` + `2018`), which is far too weak inside a long cause list and can attach
    another party's IA to the tracked matter. This version requires the CP/IB
    structure plus the configured case number and year.
    """
    number, year = matter_case_signature(case_number)
    if not number or not year:
        return []
    flat = re.sub(r'\s+', ' ', text or '')
    pat = re.compile(
        rf'C\s*\.?\s*P\s*\.?\s*\(?\s*I\s*\.?\s*B\s*\.?\s*\)?'
        rf'[^0-9]{{0,50}}0*{re.escape(str(int(number)))}\b.{{0,90}}?\b{re.escape(year)}\b',
        re.I,
    )
    wins = []
    for m in pat.finditer(flat):
        wins.append(flat[max(0, m.start()-450):min(len(flat), m.end()+800)])
    return wins


def strict_matter_windows(text: str, cfg: dict) -> list[str]:
    wins = case_windows(text, cfg.get('case_number') or '')
    if not wins:
        return []
    # Cause-list PDFs can contain several matters close together. Require the
    # tracked matter name to be present in the same local window as the exact
    # case number. Prefer a short recipient-facing name when available.
    label = cfg.get('short_name') or cfg.get('cause_title') or ''
    tokens = distinctive_tokens(label)
    if not tokens:
        return []
    required = 1 if len(tokens) == 1 else 2
    out = []
    for w in wins:
        upper = w.upper()
        if sum(1 for t in tokens[:8] if t in upper) >= required:
            out.append(w)
    return out

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


ORDER_LINK_HINTS = ('/nclt/public/order_view.php', 'order_view.php', 'ordersview.drt')


def is_order_href(href: str | None) -> bool:
    low = (href or '').lower()
    return any(h in low for h in ORDER_LINK_HINTS)


def extract_order_candidates(soup: BeautifulSoup, base_url: str) -> list[dict]:
    """Extract official NCLT order links from Case History proceeding rows.

    NCLT currently exposes proceeding orders through `nclt/public/order_view.php?path=...`.
    Older pages can still use `ordersview.drt`. PDF fetching remains optional so a
    transient order-document failure never hides a visible official order link.
    """
    seen_urls: set[str] = set()
    candidates: list[dict] = []
    for tr in soup.find_all('tr'):
        row_text = ' '.join(tr.stripped_strings)
        row_date = parse_iso_from_dmy(row_text)
        row_ias = extract_ia_labels(row_text)
        for a in tr.find_all('a'):
            href = a.get('href') or ''
            if not is_order_href(href):
                onclick = a.get('onclick') or ''
                m = re.search(r"[\"']([^\"']*(?:order_view\.php|ordersview\.drt)[^\"']*)[\"']", onclick, re.I)
                href = m.group(1) if m else ''
            if not is_order_href(href):
                continue
            order_url = urljoin(base_url, href)
            if order_url in seen_urls:
                continue
            seen_urls.add(order_url)
            candidates.append({
                'order_date': row_date,
                'row_text': row_text,
                'row_ias': row_ias,
                'source_url': order_url,
                'title': ' '.join(a.stripped_strings) or 'NCLT Order',
            })
    return candidates


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

    # Orders are the automatic recipient-facing data we keep. Import every order
    # link exposed on the exact, identity-verified case-history page. PDF fetching
    # is only used to improve IA labels for the newest unseen orders; it is never a
    # prerequisite for displaying the official order link.
    known_urls = set(cfg.get('known_order_urls') or [])
    candidates = extract_order_candidates(soup, url)

    unknown = [x for x in candidates if x['source_url'] not in known_urls]
    unknown.sort(key=lambda x: (x.get('order_date') or '', x['source_url']), reverse=True)
    refined = {}
    for item in unknown[:40]:
        labels = list(item.get('row_ias') or [])
        try:
            rr = request_with_retry(session, item['source_url'], timeout=35)
            order_text = pdf_or_html_text(rr)
            parsed = extract_ia_labels(order_text)
            if parsed:
                labels = parsed
        except Exception as e:
            result['errors'].append(f'order fetch {item.get("order_date") or ""}: {type(e).__name__}: {e}')
        refined[item['source_url']] = labels

    for item in candidates:
        # Once an official order URL has been persisted, do not resend it on every
        # scheduled run. This keeps the Cloudflare ingest path bounded and makes
        # historical backfill naturally converge to a small incremental workload.
        if item['source_url'] in known_urls:
            continue
        labels = refined.get(item['source_url'], list(item.get('row_ias') or []))
        result['orders'].append({
            'order_date': item.get('order_date'), 'order_type': item.get('title'), 'title': item.get('title'),
            'source_url': item['source_url'], 'fingerprint': hashlib.sha256(item['source_url'].encode()).hexdigest(),
            'ia_numbers': labels,
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



# Optional recipient-facing main-case cause-list Sr. No.  This parser uses the
# text already downloaded for routine exact-date IA/VC matching.  It must NEVER
# affect those existing matching decisions, the monitoring health or VC links.
# NCLT numbers parent cases in the left column and IAs 1., 2. in the next.
_MAIN_CP_ROW = re.compile(
    r'^\s*(?P<serial>[1-9]\d{0,2})\.\s+'
    r'C\s*\.?\s*P\s*\.?\s*\(\s*I\s*\.?\s*B\s*\)\s*[/\-]?\s*'
    r'0*(?P<number>\d{1,6})\s*(?:[/\-]?\s*\(?[A-Z]{2,12}\)?)?\s*[/\-]?\s*'
    r'(?P<year>20\d{2})\b',
    re.I,
)


def verified_main_sr_no(pdf_text: str, cfg: dict, ia_number: str | None = None) -> str | None:
    """Unique CP(IB) parent Sr. No., optionally restricted to its exact child IA.

    Uses only main-case rows, never the child IA column. Multiple/conflicting
    parent matches, missing case identity, or absent child IA all yield None.
    """
    num, year = matter_case_signature(cfg.get('case_number') or '')
    if not num or not year:
        return None
    target = norm_ia(ia_number) if ia_number else None
    lines = (pdf_text or '').splitlines()
    parents = []
    for index, line in enumerate(lines):
        m = _MAIN_CP_ROW.match(line)
        if m:
            parents.append((index, m))
    candidates = set()
    for i, (start, m) in enumerate(parents):
        if int(m['number']) != int(num) or m['year'] != year:
            continue
        stop = parents[i + 1][0] if i + 1 < len(parents) else len(lines)
        portion = '\n'.join(lines[start:stop])
        if not re.search(r'\bMain\s+Case\b', '\n'.join(lines[start:start + 4]), re.I):
            continue
        if target:
            # Require this *specific* child IA under this exact main case.
            if target not in {norm_ia(x) for x in extract_ia_labels(portion)}:
                continue
        candidates.add(m['serial'])
    return next(iter(candidates)) if len(candidates) == 1 else None


def safe_main_sr_no(pdf_text: str, cfg: dict, ia_number: str | None = None) -> str | None:
    # Optional metadata must NEVER disrupt existing VC/cause-list retrieval.
    try:
        return verified_main_sr_no(pdf_text, cfg, ia_number)
    except Exception:
        return None


def scan_cause_docs(session: requests.Session, cfg: dict, docs: list[dict], cache: dict[str,dict]) -> dict:
    # Cause-list surveillance no longer creates IA/application records. It only
    # enriches IAs the user already entered, and only when the exact matter case
    # number + matter name + IA number occur in the same local cause-list window.
    apps, errors, matches = [], [], []
    slug = (cfg.get('nclt_bench_slug') or infer_bench_slug(cfg.get('case_number') or '') or '').strip().lower()
    case_number = cfg.get('case_number') or ''
    known_apps = list(cfg.get('known_applications') or [])
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
            wins = strict_matter_windows(text, cfg)
            if not wins:
                continue
            if not detected_slug:
                detected_slug = bench_slug_from_row(doc.get('row_text',''))
            vc_url = extract_vc_url(text, payload.get('links'))
            match = {
                'cause_list_url': url,
                'vc_url': vc_url,
                'cause_list_date': doc.get('cause_date'),
                'cause_list_serial': safe_main_sr_no(text, cfg),
                'row_text': doc.get('row_text',''),
            }
            matches.append(match)
            cause_date = doc.get('cause_date')
            for prior in known_apps:
                target_date = (prior.get('next_hearing_date') or '').strip()
                # Recipient-facing access must be tied to the exact user-managed IA hearing date.
                # If the same IA appears in an older/newer cause list, ignore that occurrence.
                if not target_date or cause_date != target_date:
                    continue
                prior_label = prior.get('ia_number') or ''
                pkey = norm_ia(prior_label)
                if not pkey:
                    continue
                found = False
                for w in wins:
                    labels = extract_ia_labels(w)
                    if any(norm_ia(x) == pkey for x in labels):
                        found = True; break
                if found:
                    apps.append({
                        'ia_number':prior_label,
                        'source_reference':url,
                        'official_url':url,
                        'cause_list_url':url,
                        'vc_url':vc_url,
                        'cause_list_date':cause_date,
                        'cause_list_serial':safe_main_sr_no(text, cfg, prior_label),
                    })
        except Exception as e:
            errors.append(f'cause-list document {url}: {type(e).__name__}: {e}')
    status = 'success' if docs_scanned > 0 else 'failed'
    return {'apps':apps,'errors':errors,'status':status,'docs_scanned':docs_scanned,
            'detected_bench_slug':detected_slug,'matches':matches}

def dedupe_apps(items: list[dict]) -> list[dict]:
    """Merge duplicate IA detections instead of dropping later source metadata.

    Case-history discovery is intentionally added before cause-list discovery. The
    older implementation kept the first record and discarded the cause-list URL /
    VC URL found later for the same IA. That meant an IA could be correctly detected
    but never receive its dated access links.
    """
    out, by_key = [], {}
    for raw in items:
        x = dict(raw)
        key = norm_ia(x.get('ia_number',''))
        if not key:
            continue
        if key not in by_key:
            by_key[key] = x
            out.append(x)
            continue
        cur = by_key[key]
        for field in ('title','notes','source_reference','official_url','bench','next_hearing_notes'):
            if not cur.get(field) and x.get(field):
                cur[field] = x[field]
        # Access metadata belongs to a dated cause-list document. Prefer the
        # nearest upcoming cause list; otherwise retain the newest historical one.
        xd = x.get('cause_list_date')
        cd = cur.get('cause_list_date')
        today = date.today().isoformat()
        choose = False
        if xd:
            if not cd:
                choose = True
            elif xd >= today and cd < today:
                choose = True
            elif xd >= today and cd >= today and xd < cd:
                choose = True
            elif xd < today and cd < today and xd > cd:
                choose = True
        if choose:
            for field in ('cause_list_url','vc_url','cause_list_date','cause_list_serial'):
                cur[field] = x.get(field)
        if not cur.get('next_hearing_date') and x.get('next_hearing_date'):
            cur['next_hearing_date'] = x['next_hearing_date']
    return out


def api_get(session: requests.Session, path: str) -> dict:
    r = session.get(f'{DESK_URL}{path}', headers={'x-nclt-watch-secret':SECRET}, timeout=30)
    r.raise_for_status(); return r.json()


def api_post(session: requests.Session, path: str, payload: dict, *, timeout: int = 35, attempts: int = 4) -> dict:
    last = None
    for attempt in range(attempts):
        try:
            r = session.post(
                f'{DESK_URL}{path}',
                headers={'x-nclt-watch-secret':SECRET},
                json=payload,
                timeout=timeout,
            )
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            last = exc
            if attempt + 1 < attempts:
                time.sleep(1.5 * (2 ** attempt))
    raise last


def chunks(items: list[dict], size: int):
    for i in range(0, len(items), size):
        yield items[i:i+size]


def self_test() -> None:
    fixture = 'Item 16 C.P.(IB)/922(MB)/2022 Ruby Mills Private Limited IA(I.B.C)/2984 (MB)2026 IA No.701/2025'
    got = extract_ia_labels(fixture)
    assert norm_ia('IA 2984 of 2026') == norm_ia('IA(I.B.C)/2984 (MB)2026') == norm_ia('IA 2984/2026')
    assert {'IA 2984/2026','IA 701/2025'}.issubset(set(got))
    cfg={'case_number':'CP IB 922 of 2022','cause_title':'Ruby Mills Private Limited'}
    assert strict_matter_windows(fixture,cfg)
    # A bare 2/2018 elsewhere in a large cause list must not match Videocon.
    unrelated='IA 4261/2026 IN C.P.(IB)/102(MB)/2018 Some Other Company Limited'
    assert not strict_matter_windows(unrelated,{'case_number':'CP IB 2 of 2018','cause_title':'Videocon'})
    videocon='IA 1354/2020 IN CP(IB)/02/MB/2018 Mr Venugopal Dhoot IN THE MATTER OF State Bank of India V/s Videocon Industries Limited'
    assert strict_matter_windows(videocon,{'case_number':'CP IB 2 of 2018','cause_title':'Videocon'})
    assert infer_bench_slug('C.P.(IB)/922(MB)/2022') == 'mumbai'
    assert identity_matches('C.P.(IB)/922(MB)/2022 Ruby Mills Private Limited',cfg)
    assert extract_vc_url('Cisco WebEx VC Link https://ncltmum.webex.com/meet/ncltmum1', []) == 'https://ncltmum.webex.com/meet/ncltmum1'
    assert parse_iso_from_dmy('Cause List 09/10/2026 Mumbai Bench Court-I') == '2026-10-09'
    current_html = '<table><tr><td>1</td><td>1</td><td>08/07/2026</td><td>P</td><td><a href="/nclt/public/order_view.php?path=abc%3D%3D">Interim Order</a></td></tr></table>'
    legacy_html = '<table><tr><td>1</td><td>1</td><td>07/07/2026</td><td>P</td><td><a href="../../ordersview.drt?path=xyz">Interim Order</a></td></tr></table>'
    current_orders = extract_order_candidates(BeautifulSoup(current_html,'html.parser'),'https://efiling.nclt.gov.in/nclt/public/details.php?filing_no=x')
    legacy_orders = extract_order_candidates(BeautifulSoup(legacy_html,'html.parser'),'https://efiling.nclt.gov.in/nclt/public/details.php?filing_no=x')
    assert len(current_orders) == 1 and '/nclt/public/order_view.php?path=abc%3D%3D' in current_orders[0]['source_url']
    assert current_orders[0]['order_date'] == '2026-07-08'
    assert len(legacy_orders) == 1 and 'ordersview.drt?path=xyz' in legacy_orders[0]['source_url']
    assert [len(x) for x in chunks([{'x':i} for i in range(25)], 12)] == [12,12,1]
    print('NCLT watcher correctness self-test passed')

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
        preferred_dates = {d for d in (m.get('next_hearing_date'),) if d}
        cause_matches = cause_scan.get('matches') or []
        exact_matches = [x for x in cause_matches if x.get('cause_list_date') in preferred_dates]
        cause_match = (exact_matches or [None])[0]
        payload = {
            'matter_id':m['id'], 'source_url':details['url'] or CAUSE_LIST,
            'applications':all_apps, 'orders':[], 'next_listing_date':details['next_listing'],
            'errors':errors[:30], 'detected_bench_slug':cause_scan.get('detected_bench_slug'),
            'cause_list':cause_match,
            'source_health':{
                'case_status':details['status'], 'cause_list':cause_scan['status'],
                'identity_verified':details['identity_verified'], 'coverage_level':coverage,
                'cause_docs_discovered':len(cause['docs']), 'cause_docs_scanned':cause_scan['docs_scanned'],
            },
        }
        matter_orders = 0
        try:
            # Keep source-health / IA enrichment small and fast. Historical orders are
            # sent through a dedicated bounded endpoint in idempotent batches so one
            # large matter can never time out and block the others.
            result = api_post(session,'/api/nclt/ingest',payload, timeout=30)
            total_apps += int(result.get('linked_applications') or 0)
            for batch in chunks(details['orders'], ORDER_BATCH_SIZE):
                orr = api_post(
                    session, '/api/nclt/orders',
                    {'matter_id':m['id'], 'orders':batch},
                    timeout=35, attempts=4,
                )
                matter_orders += int(orr.get('imported_orders') or 0)
            total_orders += matter_orders
            matched_labels = [f"{x.get('ia_number')}@{x.get('cause_list_date')}" for x in (cause_scan.get('apps') or []) if x.get('ia_number')]
            print(f"  coverage={coverage} case={details['status']} cause-source={cause_scan['status']} exact-cause-IAs={result.get('linked_applications',0)} matched={matched_labels or 'none'} orders imported={matter_orders}")
        except Exception as e:
            ingest_failures += 1; hard_failures += 1; print(f'  ingest failed: {e}', file=sys.stderr)
        time.sleep(0.5)
    print(f'NCLT watch complete: {len(matters)} matters, {total_apps} manual IA access links matched, {total_orders} orders imported, {degraded} degraded, {ingest_failures} ingest failures, {hard_failures} hard source failures')
    return 1 if hard_failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
