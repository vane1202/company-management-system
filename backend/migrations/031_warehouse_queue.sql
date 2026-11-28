-- Additive warehouse queue. Historical warehouse_bills stay one-expense bills.
CREATE TABLE warehouse_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_ref TEXT NOT NULL UNIQUE,
  counterparty TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted','approved','rejected','paid','withdrawn')),
  business_date DATE NOT NULL,
  amount_cny NUMERIC(14,2) NOT NULL CHECK (amount_cny > 0),
  note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT '',
  paid_on DATE,
  payee TEXT NOT NULL DEFAULT '',
  pay_account TEXT NOT NULL DEFAULT '',
  pay_reference TEXT NOT NULL DEFAULT ''
);
CREATE INDEX warehouse_batches_status ON warehouse_batches(status, created_at);

CREATE TABLE warehouse_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('auto','manual')),
  queue_kind TEXT NOT NULL CHECK (queue_kind IN ('material','finished','other')),
  order_id UUID REFERENCES orders(id),
  item_id UUID REFERENCES order_items(id),
  label TEXT NOT NULL,
  material_ref TEXT NOT NULL DEFAULT '',
  reference_cny NUMERIC(14,2),
  customer_label TEXT NOT NULL DEFAULT '',
  operator_name TEXT NOT NULL DEFAULT '',
  trigger_label TEXT NOT NULL DEFAULT '',
  attachment_id UUID,
  counterparty TEXT NOT NULL,
  amount_cny NUMERIC(14,2) NOT NULL CHECK (amount_cny > 0),
  business_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('priced','batched')),
  batch_id UUID REFERENCES warehouse_batches(id),
  expense_id UUID REFERENCES order_expenses(id),
  owns_expense BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  request_key UUID,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'batched' OR batch_id IS NOT NULL),
  CHECK (queue_kind = 'other' OR (order_id IS NOT NULL AND item_id IS NOT NULL))
);
CREATE UNIQUE INDEX warehouse_lines_open_item ON warehouse_lines(item_id)
  WHERE item_id IS NOT NULL AND status IN ('priced','batched');
CREATE INDEX warehouse_lines_batch ON warehouse_lines(batch_id);
CREATE INDEX warehouse_lines_order ON warehouse_lines(order_id);

CREATE TABLE warehouse_queue_actions (
  request_key UUID PRIMARY KEY,
  actor_id UUID NOT NULL REFERENCES users(id),
  payload_hash TEXT NOT NULL,
  entity_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
