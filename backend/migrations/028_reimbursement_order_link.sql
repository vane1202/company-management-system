ALTER TABLE reimbursement_claims
  ADD COLUMN order_id uuid REFERENCES orders(id);

CREATE INDEX reimbursement_claims_order_id
  ON reimbursement_claims(order_id)
  WHERE order_id IS NOT NULL;
