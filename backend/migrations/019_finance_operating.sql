CREATE TABLE daily_operating_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (category IN ('rent', 'utilities', 'hospitality', 'other')),
  business_date DATE NOT NULL,
  amount_cny NUMERIC(14, 2) NOT NULL CHECK (amount_cny > 0),
  purpose TEXT NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 300),
  operator_name TEXT NOT NULL CHECK (char_length(operator_name) BETWEEN 1 AND 64),
  proof TEXT NOT NULL DEFAULT '' CHECK (char_length(proof) <= 200),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at TIMESTAMPTZ
);

CREATE INDEX daily_operating_expenses_date ON daily_operating_expenses (business_date) WHERE voided_at IS NULL;

CREATE TABLE reimbursement_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key TEXT NOT NULL UNIQUE,
  claimant TEXT NOT NULL CHECK (char_length(claimant) BETWEEN 1 AND 128),
  department TEXT NOT NULL DEFAULT '' CHECK (char_length(department) <= 64),
  category TEXT NOT NULL CHECK (category IN ('temporary', 'advance', 'travel', 'purchase', 'other')),
  purpose TEXT NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 500),
  amount_cny NUMERIC(14, 2) NOT NULL CHECK (amount_cny > 0),
  expense_date DATE NOT NULL,
  claim_date DATE NOT NULL,
  expense_id UUID REFERENCES order_expenses(id),
  receipt_ref TEXT NOT NULL CHECK (char_length(receipt_ref) BETWEEN 1 AND 128),
  note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note TEXT,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expense_date <= claim_date)
);

CREATE UNIQUE INDEX reimbursement_claims_receipt
  ON reimbursement_claims (claimant, receipt_ref)
  WHERE status <> 'rejected';

CREATE TABLE reimbursement_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES reimbursement_claims(id),
  amount_cny NUMERIC(14, 2) NOT NULL CHECK (amount_cny > 0),
  paid_on DATE NOT NULL,
  payee TEXT NOT NULL CHECK (char_length(payee) BETWEEN 1 AND 128),
  account TEXT NOT NULL CHECK (char_length(account) BETWEEN 1 AND 128),
  reference TEXT NOT NULL UNIQUE CHECK (char_length(reference) BETWEEN 1 AND 128),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reimbursement_payments_claim ON reimbursement_payments (claim_id);
