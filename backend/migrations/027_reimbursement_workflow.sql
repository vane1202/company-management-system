ALTER TABLE reimbursement_claims DROP CONSTRAINT reimbursement_claims_status_check;

ALTER TABLE reimbursement_claims
  ADD CONSTRAINT reimbursement_claims_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'historical'));

ALTER TABLE reimbursement_claims
  ADD COLUMN workflow_stage text NOT NULL DEFAULT 'finance'
    CHECK (workflow_stage IN ('supervisor', 'supervisor_returned', 'finance', 'historical')),
  ADD COLUMN team_id uuid REFERENCES teams(id),
  ADD COLUMN forwarded_by uuid REFERENCES users(id),
  ADD COLUMN forwarded_at timestamptz,
  ADD COLUMN supervisor_note text,
  ADD CONSTRAINT reimbursement_claims_history_stage
    CHECK ((workflow_stage = 'historical') = (status = 'historical'));

CREATE INDEX reimbursement_claims_team_stage ON reimbursement_claims(team_id, workflow_stage);

CREATE TABLE reimbursement_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES reimbursement_claims(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  mime_type text NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  image_bytes bytea NOT NULL CHECK (octet_length(image_bytes) BETWEEN 1 AND 16777216),
  UNIQUE (claim_id, position)
);
