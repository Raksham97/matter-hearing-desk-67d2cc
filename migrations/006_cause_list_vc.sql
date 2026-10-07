ALTER TABLE matters ADD COLUMN nclt_cause_list_url TEXT;
ALTER TABLE matters ADD COLUMN nclt_vc_url TEXT;
ALTER TABLE matters ADD COLUMN nclt_cause_list_date TEXT;
ALTER TABLE applications ADD COLUMN cause_list_url TEXT;
ALTER TABLE applications ADD COLUMN vc_url TEXT;
ALTER TABLE applications ADD COLUMN cause_list_date TEXT;
