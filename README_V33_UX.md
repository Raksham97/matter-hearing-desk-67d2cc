# Matter Desk v3.3 — intern-first UX + cause-list/VC access

This release simplifies the live Matter Desk without changing its core data model or NCLT reliability controls.

## Daily intern view
- Upcoming hearings are shown as clear cards, not a dense table.
- Each card shows date, broader matter/IA, bench and prep note.
- `Log update` opens the correct matter and pre-selects the IA.
- Matters are shown as compact cards with open-IA count and next hearing.
- Healthy NCLT diagnostics are hidden from the main workflow; warnings remain visible.
- Orders, hearing history, matter metadata and NCLT source diagnostics remain available inside collapsible sections.

## Official Cause List / VC links
The NCLT watcher now extracts the actual cause-list PDF and VC URL from the matched official NCLT cause-list document. Links are shown against an upcoming hearing only when the detected cause-list date equals that hearing date. The system does not guess or hard-code court VC links.

Cause lists are often published close to the hearing date. Until an exact dated cause list has been detected, the UI says that the cause list is pending rather than showing a potentially stale VC link.
