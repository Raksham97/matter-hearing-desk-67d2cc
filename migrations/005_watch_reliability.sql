ALTER TABLE matters ADD COLUMN nclt_coverage_level TEXT NOT NULL DEFAULT 'limited';
ALTER TABLE matters ADD COLUMN nclt_watch_health TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE matters ADD COLUMN nclt_source_case_status TEXT;
ALTER TABLE matters ADD COLUMN nclt_source_cause_status TEXT;
ALTER TABLE matters ADD COLUMN nclt_last_successful_check_at TEXT;
ALTER TABLE matters ADD COLUMN nclt_last_full_check_at TEXT;
ALTER TABLE matters ADD COLUMN nclt_consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nclt_sync_runs ADD COLUMN source_case_status TEXT;
ALTER TABLE nclt_sync_runs ADD COLUMN source_cause_status TEXT;
ALTER TABLE nclt_sync_runs ADD COLUMN coverage_level TEXT;
ALTER TABLE nclt_sync_runs ADD COLUMN cause_docs_scanned INTEGER NOT NULL DEFAULT 0;
UPDATE matters SET nclt_coverage_level = CASE
  WHEN lower(forum) LIKE '%nclt%' AND COALESCE(nclt_filing_no,'')<>'' AND COALESCE(nclt_bench_slug,'')<>'' THEN 'full-pending-verification'
  WHEN lower(forum) LIKE '%nclt%' THEN 'cause-list-only'
  ELSE 'not-applicable' END;
