-- Optional display-only NCLT cause-list main serial number. Existing columns and rows unchanged.
ALTER TABLE applications ADD COLUMN cause_list_serial TEXT;
ALTER TABLE matters ADD COLUMN nclt_cause_list_serial TEXT;
