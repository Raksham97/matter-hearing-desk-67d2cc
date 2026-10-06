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

CREATE INDEX IF NOT EXISTS idx_matters_status_next ON matters(status, next_hearing_date);
CREATE INDEX IF NOT EXISTS idx_matters_updated ON matters(updated_at);
CREATE INDEX IF NOT EXISTS idx_hearings_matter_date ON hearings(matter_id, hearing_date DESC, id DESC);
