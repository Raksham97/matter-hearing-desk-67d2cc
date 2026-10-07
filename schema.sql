PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS matters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cause_title TEXT NOT NULL,
  short_name TEXT,
  forum TEXT NOT NULL DEFAULT 'NCLT',
  bench TEXT,
  case_number TEXT,
  client_role TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  next_hearing_date TEXT,
  next_ia_number TEXT,
  next_hearing_notes TEXT,
  notes TEXT,
  official_case_url TEXT,
  nclt_watch_enabled INTEGER NOT NULL DEFAULT 1,
  nclt_filing_no TEXT,
  nclt_bench_slug TEXT,
  nclt_last_checked_at TEXT,
  nclt_last_error TEXT,
  nclt_next_listing_date TEXT,
  nclt_coverage_level TEXT NOT NULL DEFAULT 'limited',
  nclt_watch_health TEXT NOT NULL DEFAULT 'unknown',
  nclt_source_case_status TEXT,
  nclt_source_cause_status TEXT,
  nclt_last_successful_check_at TEXT,
  nclt_last_full_check_at TEXT,
  nclt_consecutive_failures INTEGER NOT NULL DEFAULT 0,
  nclt_cause_list_url TEXT,
  nclt_vc_url TEXT,
  nclt_cause_list_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hearings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id INTEGER NOT NULL,
  hearing_date TEXT NOT NULL,
  ia_number TEXT,
  bench TEXT,
  notes TEXT,
  outcome TEXT,
  next_hearing_date TEXT,
  next_ia_number TEXT,
  next_hearing_notes TEXT,
  order_url TEXT,
  order_title TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (matter_id) REFERENCES matters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id INTEGER NOT NULL,
  ia_number TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  bench TEXT,
  next_hearing_date TEXT,
  next_hearing_notes TEXT,
  notes TEXT,
  official_url TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  source_reference TEXT,
  detected_at TEXT,
  is_new INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  cause_list_url TEXT,
  vc_url TEXT,
  cause_list_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (matter_id) REFERENCES matters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hearing_applications (
  hearing_id INTEGER NOT NULL,
  application_id INTEGER NOT NULL,
  PRIMARY KEY (hearing_id, application_id),
  FOREIGN KEY (hearing_id) REFERENCES hearings(id) ON DELETE CASCADE,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS nclt_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id INTEGER NOT NULL,
  order_date TEXT,
  order_type TEXT,
  title TEXT,
  source_url TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  ia_numbers TEXT,
  is_new INTEGER NOT NULL DEFAULT 1,
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (matter_id) REFERENCES matters(id) ON DELETE CASCADE,
  UNIQUE(matter_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS nclt_order_applications (
  order_id INTEGER NOT NULL,
  application_id INTEGER NOT NULL,
  PRIMARY KEY (order_id, application_id),
  FOREIGN KEY (order_id) REFERENCES nclt_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS nclt_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  source_url TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  new_applications INTEGER NOT NULL DEFAULT 0,
  new_orders INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  source_case_status TEXT,
  source_cause_status TEXT,
  coverage_level TEXT,
  cause_docs_scanned INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (matter_id) REFERENCES matters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_matters_status_next ON matters(status, next_hearing_date);
CREATE INDEX IF NOT EXISTS idx_matters_updated ON matters(updated_at);
CREATE INDEX IF NOT EXISTS idx_hearings_matter_date ON hearings(matter_id, hearing_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_applications_matter ON applications(matter_id, status, next_hearing_date);
CREATE INDEX IF NOT EXISTS idx_applications_next ON applications(next_hearing_date, status);
CREATE INDEX IF NOT EXISTS idx_hearing_applications_application ON hearing_applications(application_id, hearing_id);
CREATE INDEX IF NOT EXISTS idx_nclt_orders_matter_date ON nclt_orders(matter_id, order_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_nclt_orders_new ON nclt_orders(is_new, matter_id);
CREATE INDEX IF NOT EXISTS idx_nclt_app_new ON applications(is_new, matter_id);
CREATE INDEX IF NOT EXISTS idx_nclt_sync_runs_matter ON nclt_sync_runs(matter_id, started_at DESC);
