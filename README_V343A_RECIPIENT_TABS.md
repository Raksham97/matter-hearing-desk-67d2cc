# Matter Desk v3.4.3a — recipient layout repair

Presentation-only update requested by the recipient:

- dashboard returns and displays at most 4 recent NCLT orders;
- opening a matter defaults to the last 5 hearing notes;
- IAs and Orders are separate tabs;
- older hearing history remains available behind a compact disclosure;
- matter orders remain fully available in the Orders tab;
- no watcher, IA ownership, order ingestion, database schema or reliability logic changes.

This repair supersedes the failed v3.4.3 installer, which stopped before deployment because the API still requested 10 recent orders.
