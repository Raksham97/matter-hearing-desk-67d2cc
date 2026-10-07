# Matter Desk v3.2 — NCLT Watch reliability hardening

The watch remains automatic for every active NCLT matter, but the UI now distinguishes monitoring coverage from monitoring intent.

- FULL: exact NCLT filing/diary + bench source is identity-verified and cause-list surveillance is healthy.
- LIMITED: cause-list surveillance is healthy but exact case-history/order configuration is incomplete.
- DEGRADED/STALE: one or more source checks failed or the watcher has not run recently.

Hardening changes include retries, independent source-status tracking, exact-case identity validation, landing-page + paginated cause-list discovery, current-source freshness, four checks per day, failure-visible GitHub runs, and dashboard health/status fields.

No system depending on a third-party government website can be guaranteed never to fail. The design goal is: redundancy, measurable coverage, fail-loud behavior, and no silent green state when source coverage is incomplete.
