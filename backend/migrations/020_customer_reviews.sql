ALTER TABLE fan_leads
  ADD COLUMN IF NOT EXISTS invalid_review_status TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS invalid_review_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS invalid_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invalid_reviewed_by UUID REFERENCES users(id);

ALTER TABLE fan_leads DROP CONSTRAINT IF EXISTS fan_leads_invalid_review_status_check;
ALTER TABLE fan_leads ADD CONSTRAINT fan_leads_invalid_review_status_check
  CHECK (invalid_review_status IN ('', 'pending', 'approved', 'rejected', 'restored'));
