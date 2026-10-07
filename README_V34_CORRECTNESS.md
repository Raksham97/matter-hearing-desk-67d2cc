# Matter Desk v3.4 — correctness + recipient-facing cleanup

This patch is intentionally conservative.

- IA/application records are user-managed only. NCLT Watch no longer creates IAs.
- Existing background NCLT-detected IA rows remain in D1 for audit/history but are hidden from the recipient UI/Excel and cannot drive upcoming hearings.
- Cause-list/VC access can enrich an existing manually entered IA only after exact case + matter-name + IA + date matching.
- NCLT orders are restored as a prominent recipient-facing section and recent orders appear on the home screen.
- The watcher now persists every order link exposed on the exact identity-verified NCLT case-history page; PDF fetching is only optional IA-label enrichment.
- Automatic “NCLT updates to review”, NEW badges, Mark reviewed, sync-health labels and recipient-facing sync diagnostics are removed.
- Background NCLT reliability monitoring remains active in the scheduled watcher/GitHub Actions.
