# Matter Desk v3.1 — NCLT Watch always on

For every active NCLT broader matter, NCLT Watch is automatic. There is no per-matter enable switch.

- Existing NCLT matters are migrated to watch enabled.
- Newly created/edited NCLT matters are always watch enabled.
- The watcher endpoint independently selects all active NCLT matters, so an old/stale flag cannot silently disable surveillance.
- Filing/diary number and bench slug remain optional metadata used to improve matching and historical order backfill; they do not turn monitoring on/off.
