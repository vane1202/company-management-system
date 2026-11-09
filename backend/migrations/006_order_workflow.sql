CREATE TABLE order_details (
  order_id UUID PRIMARY KEY REFERENCES orders(id),
  persona_name TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  customer_currency TEXT NOT NULL CHECK(customer_currency IN ('CNY','TWD','USD')),
  customer_due NUMERIC(14,2) NOT NULL CHECK(customer_due>=0),
  shipped_on DATE,
  version INTEGER NOT NULL DEFAULT 1,
  request_key UUID NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL
);
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  label TEXT NOT NULL,
  material_ref TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK(kind IN ('material','finished')),
  price_cny NUMERIC(14,2) NOT NULL CHECK(price_cny>=0),
  buying_fee_cny NUMERIC(14,2) NOT NULL,
  CHECK(buying_fee_cny=CASE WHEN kind='material' THEN round(price_cny*0.1,2) ELSE 0 END)
);
CREATE INDEX order_items_order ON order_items(order_id);
CREATE TABLE customer_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  payment_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK(amount>0),
  currency TEXT NOT NULL CHECK(currency IN ('CNY','TWD','USD')),
  credit_amount NUMERIC(14,2) NOT NULL CHECK(credit_amount>0),
  purpose TEXT NOT NULL CHECK(purpose IN ('deposit','balance','full')),
  channel TEXT NOT NULL,
  third_party BOOLEAN NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  void_reason TEXT,
  voided_at TIMESTAMPTZ,
  request_key UUID NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  CHECK(third_party OR currency='CNY')
);
CREATE UNIQUE INDEX customer_payments_reference ON customer_payments(channel,currency,reference) WHERE reference<>'' AND voided_at IS NULL;
CREATE INDEX customer_payments_order ON customer_payments(order_id);
CREATE TABLE order_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  business_date DATE NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('goods','labor','certificate','box','shipping','other')),
  label TEXT NOT NULL,
  amount_cny NUMERIC(14,2) NOT NULL CHECK(amount_cny>0),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  void_reason TEXT,
  voided_at TIMESTAMPTZ,
  request_key UUID NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL
);
CREATE INDEX order_expenses_order ON order_expenses(order_id);
-- Bounded private originals live inside the backed-up DB, never the static site.
CREATE TABLE order_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  item_id UUID REFERENCES order_items(id),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
  image_bytes BYTEA NOT NULL CHECK(octet_length(image_bytes) BETWEEN 12 AND 8388608),
  sha256 TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id,sha256)
);
CREATE INDEX order_attachments_order ON order_attachments(order_id);
CREATE TABLE finance_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(currency IN ('CNY','TWD','USD')),
  settled_on DATE NOT NULL,
  fee_amount NUMERIC(14,2) NOT NULL CHECK(fee_amount>=0),
  fee_currency TEXT NOT NULL CHECK(fee_currency IN ('CNY','TWD','USD')),
  fee_percent NUMERIC(7,4),
  fx_rate NUMERIC(20,6),
  net_cny NUMERIC(14,2) NOT NULL CHECK(net_cny>=0),
  note TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  void_reason TEXT,
  voided_at TIMESTAMPTZ,
  request_key UUID NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  CHECK(fee_percent IS NULL OR fee_percent BETWEEN 0 AND 100),
  CHECK(fx_rate IS NULL OR fx_rate>0)
);
CREATE TABLE settlement_allocations (
  settlement_id UUID NOT NULL REFERENCES finance_settlements(id),
  payment_id UUID NOT NULL REFERENCES customer_payments(id),
  foreign_amount NUMERIC(14,2) NOT NULL CHECK(foreign_amount>0),
  net_cny NUMERIC(14,2) NOT NULL CHECK(net_cny>=0),
  PRIMARY KEY(settlement_id,payment_id)
);
CREATE INDEX settlement_allocations_payment ON settlement_allocations(payment_id);
