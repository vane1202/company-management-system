ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS material_cost_cny NUMERIC(14,2) CHECK (material_cost_cny IS NULL OR material_cost_cny >= 0),
  ADD COLUMN IF NOT EXISTS material_lot_no TEXT NOT NULL DEFAULT '';

ALTER TABLE order_details
  ADD COLUMN IF NOT EXISTS deal_channel TEXT NOT NULL DEFAULT 'live' CHECK (deal_channel IN ('live', 'private')),
  ADD COLUMN IF NOT EXISTS project_line TEXT NOT NULL DEFAULT '';

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS sourcing_no_settle BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE customer_payments
  ADD COLUMN IF NOT EXISTS received_cny NUMERIC(14,2) CHECK (received_cny IS NULL OR received_cny >= 0);

DO $$
DECLARE
  r RECORD;
BEGIN
  -- 1. order_details.customer_currency
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'order_details'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%customer_currency%'
  LOOP
    EXECUTE format('ALTER TABLE order_details DROP CONSTRAINT %I', r.conname);
  END LOOP;
  ALTER TABLE order_details
    ADD CONSTRAINT order_details_customer_currency_check
    CHECK (customer_currency IN ('CNY', 'TWD', 'USD', 'SGD', 'HKD'));

  -- 2. order_items.kind and buying_fee_cny
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'order_items'::regclass AND contype = 'c'
      AND (pg_get_constraintdef(oid) LIKE '%buying_fee_cny%' OR pg_get_constraintdef(oid) LIKE '%kind%')
  LOOP
    EXECUTE format('ALTER TABLE order_items DROP CONSTRAINT %I', r.conname);
  END LOOP;
  ALTER TABLE order_items
    ADD CONSTRAINT order_items_kind_check
    CHECK (kind IN ('material', 'finished', 'service')),
    ADD CONSTRAINT order_items_buying_fee_cny_check
    CHECK (buying_fee_cny >= 0);

  -- 3. customer_payments.currency
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'customer_payments'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%currency IN%'
  LOOP
    EXECUTE format('ALTER TABLE customer_payments DROP CONSTRAINT %I', r.conname);
  END LOOP;
  ALTER TABLE customer_payments
    ADD CONSTRAINT customer_payments_currency_check
    CHECK (currency IN ('CNY', 'TWD', 'USD', 'SGD', 'HKD'));

  -- 4. finance_settlements.currency and fee_currency
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'finance_settlements'::regclass AND contype = 'c'
      AND (pg_get_constraintdef(oid) LIKE '%currency IN%' OR pg_get_constraintdef(oid) LIKE '%fee_currency IN%')
  LOOP
    EXECUTE format('ALTER TABLE finance_settlements DROP CONSTRAINT %I', r.conname);
  END LOOP;
  ALTER TABLE finance_settlements
    ADD CONSTRAINT finance_settlements_currency_check
    CHECK (currency IN ('CNY', 'TWD', 'USD', 'SGD', 'HKD')),
    ADD CONSTRAINT finance_settlements_fee_currency_check
    CHECK (fee_currency IN ('CNY', 'TWD', 'USD', 'SGD', 'HKD'));
END $$;
