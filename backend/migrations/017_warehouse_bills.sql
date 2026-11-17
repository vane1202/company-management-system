CREATE TABLE warehouse_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  expense_id UUID REFERENCES order_expenses(id),
  owns_expense BOOLEAN NOT NULL DEFAULT FALSE,
  after_sale_charge_id UUID REFERENCES order_charges(id),
  category TEXT NOT NULL CHECK(category IN ('goods','labor','certificate','box','shipping','other','sourcing','accessory','design')),
  label TEXT NOT NULL,
  counterparty TEXT NOT NULL,
  amount_cny NUMERIC(14,2) NOT NULL CHECK(amount_cny > 0),
  business_date DATE NOT NULL,
  material_ref TEXT NOT NULL,
  proof TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','approved','rejected')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT '',
  CHECK(status <> 'approved' OR expense_id IS NOT NULL)
);
CREATE UNIQUE INDEX warehouse_bill_active_expense ON warehouse_bills(expense_id)
  WHERE expense_id IS NOT NULL AND status <> 'rejected';
CREATE INDEX warehouse_bills_order ON warehouse_bills(order_id);
ALTER TABLE supplier_payments ADD COLUMN warehouse_bill_id UUID REFERENCES warehouse_bills(id);
CREATE INDEX supplier_payments_warehouse_bill ON supplier_payments(warehouse_bill_id);
CREATE TABLE warehouse_actions (
  request_key UUID PRIMARY KEY,
  actor_id UUID NOT NULL REFERENCES users(id),
  payload_hash TEXT NOT NULL,
  bill_id UUID NOT NULL REFERENCES warehouse_bills(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
