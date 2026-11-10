-- Historical rows remain unclassified/unpaid-unknown; never invent payment records.
ALTER TABLE editor_reports ADD COLUMN editor_name TEXT;
ALTER TABLE editor_reports DROP CONSTRAINT editor_reports_user_date_persona_key;
CREATE UNIQUE INDEX editor_reports_legacy_key ON editor_reports(user_id,business_date,persona_name) WHERE editor_name IS NULL;
CREATE UNIQUE INDEX editor_reports_teacher_key ON editor_reports(editor_name,business_date,persona_name) WHERE editor_name IS NOT NULL;
ALTER TABLE editor_reports ADD CHECK(editor_name IS NULL OR editor_name IN ('魏磊','尚杰','十七'));

ALTER TABLE order_details ADD COLUMN persona_code TEXT NOT NULL DEFAULT '', ADD COLUMN live_room_code TEXT NOT NULL DEFAULT '', ADD COLUMN host_name TEXT NOT NULL DEFAULT '', ADD COLUMN customer_code TEXT NOT NULL DEFAULT '';
ALTER TABLE order_expenses ADD COLUMN counterparty TEXT NOT NULL DEFAULT '', ADD COLUMN item_id UUID REFERENCES order_items(id) ON DELETE SET NULL, ADD COLUMN note TEXT NOT NULL DEFAULT '';
ALTER TABLE order_expenses ADD COLUMN payment_tracking_started BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE order_expenses DROP CONSTRAINT order_expenses_category_check;
ALTER TABLE order_expenses ADD CHECK(category IN ('goods','labor','certificate','box','shipping','other','sourcing','accessory','design'));
CREATE TABLE order_charges (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL REFERENCES orders(id),
 business_date DATE NOT NULL, label TEXT NOT NULL, amount_cny NUMERIC(14,2) NOT NULL CHECK(amount_cny>0),
 customer_amount NUMERIC(14,2) NOT NULL CHECK(customer_amount>0), note TEXT NOT NULL DEFAULT '',
 created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 voided_at TIMESTAMPTZ, void_reason TEXT, request_key UUID NOT NULL UNIQUE, payload_hash TEXT NOT NULL
);
CREATE INDEX order_charges_order ON order_charges(order_id);
CREATE TABLE supplier_payments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), expense_id UUID NOT NULL REFERENCES order_expenses(id),
 paid_on DATE NOT NULL, payee TEXT NOT NULL, account TEXT NOT NULL, reference TEXT NOT NULL,
 amount_cny NUMERIC(14,2) NOT NULL CHECK(amount_cny>0), note TEXT NOT NULL DEFAULT '',
 created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 voided_at TIMESTAMPTZ, void_reason TEXT, request_key UUID NOT NULL UNIQUE, payload_hash TEXT NOT NULL
);
CREATE INDEX supplier_payments_expense ON supplier_payments(expense_id);
CREATE UNIQUE INDEX supplier_payment_reference ON supplier_payments(account,reference) WHERE voided_at IS NULL;
CREATE TABLE ad_accounts (
 code TEXT PRIMARY KEY CHECK(char_length(code) BETWEEN 1 AND 64), name TEXT NOT NULL,
 opened_on DATE NOT NULL, opening_usd NUMERIC(14,2) NOT NULL CHECK(opening_usd>=0),
 created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE ops_reports ADD COLUMN ad_account_ref TEXT REFERENCES ad_accounts(code);
ALTER TABLE ops_reports DROP CONSTRAINT ops_reports_user_date_persona_key;
CREATE UNIQUE INDEX ops_reports_account_key ON ops_reports(user_id,business_date,persona_name,COALESCE(ad_account_ref,''));
CREATE TABLE ad_topups (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), account_ref TEXT NOT NULL REFERENCES ad_accounts(code),
 paid_on DATE NOT NULL, credited_usd NUMERIC(14,2) NOT NULL CHECK(credited_usd>0),
 paid_cny NUMERIC(14,2) NOT NULL CHECK(paid_cny>0), payment_account TEXT NOT NULL, reference TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '', created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 voided_at TIMESTAMPTZ, void_reason TEXT, request_key UUID NOT NULL UNIQUE, payload_hash TEXT NOT NULL
);
CREATE UNIQUE INDEX ad_topups_reference ON ad_topups(payment_account,reference) WHERE voided_at IS NULL;
