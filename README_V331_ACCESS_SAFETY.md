# Matter Desk v3.3.1 — access-link safety + IA canonicalisation

This is a focused reliability/polish repair on top of v3.3.

Changes:
- Treats common NCLT IA formats (`IA 2984 of 2026`, `IA 2984/2026`, `IA(I.B.C)/2984 (MB)2026`) as the same IA.
- Collapses duplicate IA records created by formatting differences while preserving hearing/order links and preferring manually maintained data.
- Merges case-history and cause-list detections so an existing IA can receive the official dated cause-list / VC link.
- Shows Cause List / Join VC only when the official cause-list date exactly matches the next hearing date.
- Clears previously stored stale access links whose dates do not match the next hearing date.
- Makes the NCLT update count exact rather than capped at 20.
- Uses the wording "updates to review / IA detections" rather than implying every newly detected record was necessarily newly filed that day.
