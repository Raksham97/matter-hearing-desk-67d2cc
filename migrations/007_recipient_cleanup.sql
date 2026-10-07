-- Recipient-facing cleanup: NCLT surveillance remains background-only.
-- Automatically detected IA rows are retained for audit/history, but they no longer
-- drive upcoming hearings or recipient-facing counts. Review badges are retired.
UPDATE applications
SET is_new = 0,
    next_hearing_date = NULL,
    next_hearing_notes = NULL,
    cause_list_url = NULL,
    vc_url = NULL,
    cause_list_date = NULL,
    updated_at = datetime('now')
WHERE upper(COALESCE(source,'')) = 'NCLT';

UPDATE nclt_orders SET is_new = 0;
