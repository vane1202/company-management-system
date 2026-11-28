ALTER TABLE reimbursement_claims DROP CONSTRAINT IF EXISTS reimbursement_claims_claim_type_check;

ALTER TABLE reimbursement_claims
  ADD CONSTRAINT reimbursement_claims_claim_type_check
    CHECK (claim_type IN ('live_room', 'business', 'welfare', 'office'));

ALTER TABLE reimbursement_claims
  ADD COLUMN IF NOT EXISTS live_room_id TEXT CHECK (live_room_id IS NULL OR char_length(live_room_id) <= 64),
  ADD COLUMN IF NOT EXISTS live_room_name TEXT CHECK (live_room_name IS NULL OR char_length(live_room_name) <= 128);
