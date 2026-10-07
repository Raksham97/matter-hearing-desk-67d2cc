UPDATE matters
SET nclt_watch_enabled = 1,
    updated_at = datetime('now')
WHERE UPPER(COALESCE(forum,'NCLT')) LIKE '%NCLT%';
