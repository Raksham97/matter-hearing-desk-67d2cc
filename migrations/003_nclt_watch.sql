ALTER TABLE matters ADD COLUMN nclt_watch_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE matters ADD COLUMN nclt_filing_no TEXT;
ALTER TABLE matters ADD COLUMN nclt_bench_slug TEXT;
ALTER TABLE matters ADD COLUMN nclt_last_checked_at TEXT;
ALTER TABLE matters ADD COLUMN nclt_last_error TEXT;
ALTER TABLE matters ADD COLUMN nclt_next_listing_date TEXT;

ALTER TABLE applications ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE applications ADD COLUMN source_reference TEXT;
ALTER TABLE applications ADD COLUMN detected_at TEXT;
ALTER TABLE applications ADD COLUMN is_new INTEGER NOT NULL DEFAULT 0;
ALTER TABLE applications ADD COLUMN last_seen_at TEXT;

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
  FOREIGN KEY (matter_id) REFERENCES matters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nclt_orders_matter_date ON nclt_orders(matter_id, order_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_nclt_orders_new ON nclt_orders(is_new, matter_id);
CREATE INDEX IF NOT EXISTS idx_nclt_app_new ON applications(is_new, matter_id);
CREATE INDEX IF NOT EXISTS idx_nclt_sync_runs_matter ON nclt_sync_runs(matter_id, started_at DESC);
