-- Finance supplies commission-reference performance; the app does not calculate commission.
CREATE TABLE live_paid_performance (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 business_date DATE NOT NULL,
 live_room_code TEXT NOT NULL CHECK(length(trim(live_room_code)) BETWEEN 1 AND 64),
 host_name TEXT NOT NULL CHECK(length(trim(host_name)) BETWEEN 1 AND 128),
 amount_cny NUMERIC(14,2) NOT NULL CHECK(amount_cny>=0),
 note TEXT NOT NULL DEFAULT '',
 created_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 request_key UUID NOT NULL UNIQUE,
 payload_hash TEXT NOT NULL,
 voided_at TIMESTAMPTZ,
 void_reason TEXT,
 voided_by UUID REFERENCES users(id)
);
CREATE UNIQUE INDEX live_paid_performance_daily ON live_paid_performance(business_date,live_room_code,host_name) WHERE voided_at IS NULL;
ALTER TABLE order_charges ADD COLUMN costs_completed_at TIMESTAMPTZ;
ALTER TABLE customer_payments ADD COLUMN after_sale_charge_id UUID REFERENCES order_charges(id);
ALTER TABLE order_expenses ADD COLUMN after_sale_charge_id UUID REFERENCES order_charges(id);
CREATE INDEX customer_payments_after_sale ON customer_payments(after_sale_charge_id) WHERE voided_at IS NULL;
CREATE INDEX order_expenses_after_sale ON order_expenses(after_sale_charge_id) WHERE voided_at IS NULL;
