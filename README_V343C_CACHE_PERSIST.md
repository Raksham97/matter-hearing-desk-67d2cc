# Matter Desk v3.4.3c

Presentation-only persistence repair.

- Keeps Last 5 hearing notes as the default matter tab.
- Keeps IAs and Orders as secondary tabs.
- Keeps home Recent NCLT orders capped at four.
- Changes the frontend asset version to v3.4.3c so Safari cannot reuse the older cached JavaScript.
- Polls the production Pages alias after deployment before declaring success.
- Does not modify D1, watcher logic, order ingestion, IA logic, or APP_PASSWORD.
