PRAGMA foreign_keys = ON;

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

CREATE INDEX IF NOT EXISTS idx_applications_matter ON applications(matter_id, status, next_hearing_date);
CREATE INDEX IF NOT EXISTS idx_applications_next ON applications(next_hearing_date, status);
CREATE INDEX IF NOT EXISTS idx_hearing_applications_application ON hearing_applications(application_id, hearing_id);

-- Preserve the existing single-IA model by turning each legacy "next IA" into an application.
INSERT INTO applications (
  matter_id, ia_number, title, status, bench, next_hearing_date,
  next_hearing_notes, notes, created_at, updated_at
)
SELECT
  m.id,
  trim(m.next_ia_number),
  NULL,
  'Pending',
  m.bench,
  m.next_hearing_date,
  m.next_hearing_notes,
  'Migrated from the original matter-level next IA field.',
  datetime('now'), datetime('now')
FROM matters m
WHERE m.next_ia_number IS NOT NULL
  AND trim(m.next_ia_number) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM applications a
    WHERE a.matter_id = m.id
      AND lower(trim(a.ia_number)) = lower(trim(m.next_ia_number))
  );

-- Preserve historic IA references too, so old hearing entries can be linked to an application.
INSERT INTO applications (
  matter_id, ia_number, title, status, bench, next_hearing_date,
  next_hearing_notes, notes, created_at, updated_at
)
SELECT DISTINCT
  h.matter_id,
  trim(h.ia_number),
  NULL,
  'Pending',
  h.bench,
  h.next_hearing_date,
  h.next_hearing_notes,
  'Migrated from an existing hearing entry.',
  datetime('now'), datetime('now')
FROM hearings h
WHERE h.ia_number IS NOT NULL
  AND trim(h.ia_number) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM applications a
    WHERE a.matter_id = h.matter_id
      AND lower(trim(a.ia_number)) = lower(trim(h.ia_number))
  );

INSERT OR IGNORE INTO hearing_applications (hearing_id, application_id)
SELECT h.id, a.id
FROM hearings h
JOIN applications a
  ON a.matter_id = h.matter_id
 AND lower(trim(a.ia_number)) = lower(trim(h.ia_number))
WHERE h.ia_number IS NOT NULL AND trim(h.ia_number) <> '';
