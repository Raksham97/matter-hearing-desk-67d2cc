# Matter Desk v3.4.2 — resilient NCLT order backfill

This patch fixes the live order-ingest timeout without changing recipient-facing IA behavior.

- NCLT orders are posted through a dedicated idempotent endpoint in small batches.
- D1 order upserts use `DB.batch()` rather than one remote query at a time.
- Timed-out batches retry safely because `(matter_id, fingerprint)` is unique.
- Already persisted official order URLs are not resent on every scheduled watcher run.
- A large matter cannot block successfully discovered orders from another matter.
- NCLT Watch still never creates recipient-facing IAs.
