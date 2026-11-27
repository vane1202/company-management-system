ALTER TABLE reimbursement_claims
  ADD COLUMN claim_type TEXT NOT NULL DEFAULT 'business'
    CHECK (claim_type IN ('business', 'welfare', 'office')),
  ADD COLUMN welfare_customer TEXT NOT NULL DEFAULT ''
    CHECK (char_length(welfare_customer) <= 128),
  ADD COLUMN posted_expense_id UUID REFERENCES order_expenses(id);

CREATE INDEX reimbursement_claims_welfare_pending
  ON reimbursement_claims (created_by, expense_date)
  WHERE claim_type = 'welfare' AND order_id IS NULL AND status = 'approved';
