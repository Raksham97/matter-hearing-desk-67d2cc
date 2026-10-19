#!/usr/bin/env python3
"""Bounded NCLT upstream-outage policy. No Cloudflare/D1/data writes.

Only verified GitHub Actions NCLT cause-list artifacts count as fresh. As a
one-time migration, successful executions of the previously audited commit can
seed the initial age calculation. A source outage is NEVER a verified scan.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

BASELINE = '882d108e42bb0ed2f9106a62213f9c07d4214375'
REPO = 'Raksham97/matter-hearing-desk-67d2cc'
PREFIX = 'nclt-cause-verified-'
MAX_GRACE_HOURS = 30
RECOVERY_FRESH_HOURS = 3


def parse_stamp(raw):
    try:
        value = datetime.fromisoformat(str(raw).replace('Z', '+00:00'))
        return value.astimezone(timezone.utc) if value.tzinfo else None
    except (ValueError, TypeError, OverflowError):
        return None


def classify_cause_outage(cause):
    """Only an entirely unreachable official listing is transport-transient.

    Parser drift, a 200 OK with no documents, partial discovery, or unknown
    exceptions are NOT automatically suppressed. No guessing that 403 is healthy.
    """
    if (cause.get('status') == 'success' or cause.get('docs')
            or cause.get('successful_pages', 0) or cause.get('responded_pages', 0)):
        return False
    failures = cause.get('errors') or []
    if not failures:
        return False
    transient = ('Timeout', 'ConnectionError', 'ChunkedEncodingError',
                 'RemoteDisconnected', 'ConnectionResetError',
                 'HTTPError: 429', 'HTTPError: 500', 'HTTPError: 502',
                 'HTTPError: 503', 'HTTPError: 504',
                 'HTTPError: 403')
    return all('cause-list page' in e and any(s in e for s in transient) for e in failures)


def classify_case_history_outage(detail):
    """Only an upstream transport fault, never identity or parser failure.

    Official HTTP 200 with insufficient text is intentionally not treated as
    transient. It might be an upstream block or a changed page schema; we must
    investigate rather than silently mark it healthy.
    """
    if detail.get('status') != 'failed':
        return False
    errors = detail.get('errors') or []
    transient = ('ReadTimeout', 'ConnectTimeout', 'ConnectionError',
                 'ChunkedEncodingError', 'RemoteDisconnected',
                 'ConnectionResetError', 'HTTPError: 403',
                 'HTTPError: 429', 'HTTPError: 500', 'HTTPError: 502',
                 'HTTPError: 503', 'HTTPError: 504')
    return bool(errors) and all(
        str(e).startswith('case-status fetch: ') and
        any(x in str(e) for x in transient)
        for e in errors
    )


def gh_json(path, *, token, opener=urllib.request.urlopen):
    req = urllib.request.Request(
        f'https://api.github.com/repos/{REPO}/{path}',
        headers={'Authorization': f'Bearer {token}',
                 'Accept': 'application/vnd.github+json',
                 'User-Agent': 'matter-desk-health-gate/1.0'},
    )
    with opener(req, timeout=20) as response:
        return json.load(response)


def latest_verified_time(token, *, now=None, fetch=gh_json):
    """Only the most recent actual successful NCLT source verification counts."""
    now = now or datetime.now(timezone.utc)
    artifacts = fetch('actions/artifacts?per_page=100', token=token)
    stamps = [parse_stamp(a.get('created_at')) for a in artifacts.get('artifacts', [])
              if str(a.get('name', '')).startswith(PREFIX) and not a.get('expired', False)]
    stamps = [s for s in stamps if s and s <= now]
    if stamps:
        return max(stamps), 'verified-artifact'
    # Migration only: the previous audited watcher failed hard whenever shared
    # cause-list discovery failed, so a success at that precise old SHA proves
    # that source-discovery threshold was met. Never use successes of new code.
    historical = fetch('actions/workflows/nclt-watch.yml/runs?per_page=100&status=success',token=token)
    stamps = [parse_stamp(r.get('created_at')) for r in historical.get('workflow_runs', [])
              if r.get('head_sha') == BASELINE and r.get('conclusion') == 'success']
    stamps = [s for s in stamps if s and s <= now]
    return (max(stamps), 'audited-prepatch-run') if stamps else (None, 'none')


def age_hours(verified, now=None):
    if verified is None:
        return None
    now = now or datetime.now(timezone.utc)
    return (now-verified).total_seconds() / 3600


def gate(*, outcome, error_class, verified_age, max_grace=MAX_GRACE_HOURS):
    """Outcome, class, and age all must agree; untrusted exception => failure."""
    if outcome == 'success':
        return True, 'Watcher finished normally'
    if outcome != 'failure' or error_class != 'transient-cause-unavailable':
        return False, 'Watcher failed for nontransient or unclassified reason'
    if verified_age is None or verified_age < 0 or verified_age > max_grace:
        return False, f'No sufficiently recent verified NCLT cause-list scan (age={verified_age})'
    return True, f'Temporary NCLT cause-list outage; last verified scan {verified_age:.1f}h ago'


def main(argv=None):
    p=argparse.ArgumentParser()
    p.add_argument('--mode',choices=['gate','recovery'],required=True)
    args=p.parse_args(argv)
    token=os.environ.get('GH_TOKEN','') or os.environ.get('GITHUB_TOKEN','')
    if not token:
        print('::error::Missing GitHub Actions read token; cannot verify monitoring health',flush=True)
        return 1
    try:
        verified, source=latest_verified_time(token)
    except Exception as e:
        print(f'::error::Could not inspect verified NCLT health evidence: {type(e).__name__}',flush=True)
        return 1
    age=age_hours(verified)
    if args.mode=='recovery':
        # If evidence cannot be obtained, run rather than silently skip checking.
        due=age is None or age>=RECOVERY_FRESH_HOURS
        output=os.environ.get('GITHUB_OUTPUT')
        if output:
            with open(output,'a',encoding='utf-8') as f:
                f.write(f'run={str(due).lower()}\n')
        else:
            print(f'run={str(due).lower()}')
        print(f'NCLT_RECOVERY_GATE: verified={source}; age_h={age}; run={due}',flush=True)
        return 0
    outcome=os.environ.get('WATCH_OUTCOME','')
    failure=os.environ.get('WATCH_ERROR_CLASS','')
    ok,reason=gate(outcome=outcome,error_class=failure,verified_age=age)
    if ok and outcome=='success':
        print('NCLT_WATCHER_COMPLETED: verified history is unaffected by this health gate',flush=True)
    elif ok:
        print(f'::warning::{reason}. Existing official hearing/VC/Sr. No. records retained; cause-list coverage DEGRADED. Automatic recovery pending.',flush=True)
        if summary:=os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(summary,'a',encoding='utf-8') as f:
                f.write('### NCLT cause-list source temporarily unavailable\n\n'
                        f'{reason}. This was **not** a verified cause-list scan. '
                        'Previously verified hearing links remain subject to their dates.\n')
    else:
        print(f'::error::{reason}; prior evidence={source}; age_h={age}. Preserve data and investigate.',flush=True)
    return 0 if ok else 1


if __name__=='__main__':
    raise SystemExit(main())
