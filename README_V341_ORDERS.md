# Matter Desk v3.4.1 — NCLT order-link repair

This patch fixes current NCLT Case History order ingestion.

NCLT's current public Case History uses `nclt/public/order_view.php?path=...` for proceeding orders. Older Matter Desk logic only accepted the legacy `ordersview.drt` URL format, so a successful case-history sync could still import zero orders.

Changes:
- accept current `order_view.php` and legacy `ordersview.drt` order links;
- keep PDF fetching optional: an official order link is stored even if the PDF cannot be parsed that run;
- regression-test both URL formats before push;
- after the real watcher run, fail the installer if the tracked matters still have zero imported NCLT orders;
- print per-matter order totals and the newest imported order links for acceptance checking.

No IA creation logic, recipient-facing review labels, or CIRP/Medlexion code is changed.
