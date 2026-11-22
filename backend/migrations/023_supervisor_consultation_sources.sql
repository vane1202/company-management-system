CREATE TABLE supervisor_consultation_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID UNIQUE REFERENCES ops_reports(id) ON DELETE CASCADE,
  ad_account_ref TEXT REFERENCES ad_accounts(code) ON DELETE CASCADE,
  active_dates DATERANGE NOT NULL CHECK (NOT isempty(active_dates) AND NOT lower_inf(active_dates)),
  team_ids UUID[] NOT NULL CHECK (cardinality(team_ids) > 0 AND array_position(team_ids, NULL) IS NULL),
  CHECK (
    (report_id IS NOT NULL AND ad_account_ref IS NULL AND NOT upper_inf(active_dates) AND upper(active_dates) - lower(active_dates) = 1)
    OR (report_id IS NULL AND ad_account_ref IS NOT NULL)
  ),
  EXCLUDE USING gist (ad_account_ref WITH =, active_dates WITH &&) WHERE (ad_account_ref IS NOT NULL)
);
