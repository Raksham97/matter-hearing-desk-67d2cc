# Matter Desk

Private NCLT/NCLAT hearing and matter tracker for Ritika.

## What it does

- Password-protected dashboard.
- Upcoming hearings for the next 7 days: date, IA, cause title, bench and notes.
- Click any matter to see its full hearing history.
- End-of-day hearing log: date, IA, bench, short notes, outcome, next date and order URL.
- Matter directory with official case links.
- Excel export with an Index sheet plus one sheet per matter. Matter names on the Index jump to their worksheet.
- JSON backup from the UI and SQL backup from `scripts/backup.sh`.

## Data model

Matter data and hearing history live in Cloudflare D1. They are not committed to GitHub and are not shipped as static website assets.

## Authentication

`APP_PASSWORD` and `AUTH_SECRET` are encrypted Cloudflare Pages secrets. The app issues a signed, HttpOnly, Secure, SameSite=Strict session cookie valid for 14 days.

## Cost target

Designed for Cloudflare Workers/Pages Free + D1 Free. For a small law practice this is expected to remain far below the free limits; monitor Cloudflare usage if the application grows substantially.

## Future integrations

The schema deliberately stores forum, bench, case number, next date and official URLs so NCLT/NCLAT cause-list/order reconciliation can be added later without redesigning the core tracker.
