#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
DB_NAME="$(python3 - <<'PY'
import json
p=json.load(open('wrangler.jsonc'))
print(p['d1_databases'][0]['database_name'])
PY
)"
OUT="matter-desk-backup-$(date +%Y%m%d-%H%M%S).sql"
npx --yes wrangler@latest d1 export "$DB_NAME" --remote --output "$OUT" --skip-confirmation
echo "Backup written to: $PWD/$OUT"
