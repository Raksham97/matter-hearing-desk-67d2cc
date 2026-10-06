# Matter Desk v3 — NCLT Watch

Adds public-source NCLT surveillance to the existing private Matter Desk.

- Watches enabled broader matters three times daily.
- Detects IA/application numbers appearing against the main case in recent NCLT cause lists.
- When an NCLT filing/diary number and bench slug are supplied, imports the public case proceeding/order history from NCLT and continues watching for new orders.
- Parses official NCLT order documents for IA references and links each order to matching IAs when possible.
- Shows unreviewed NCLT activity as NEW in Matter Desk until marked reviewed.

Important timing note: "new IA" means newly visible on NCLT's public systems, not a guaranteed real-time notification at the instant a private filing is submitted.

Operational notes:
- The first successful sync establishes a baseline: historical IAs/orders are imported without NEW badges.
- Later unseen public IAs/orders are marked NEW.
- Historical order backfill is intentionally incremental (up to 25 previously unseen order links per check) so old matters cannot stall the scheduled watcher.
- Orders remain attached to the broader matter even when the public order text does not expose enough information to allocate them confidently to a specific IA.
