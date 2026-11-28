-- Payment proof and finance arrival check. Historical rows stay confirmed.
ALTER TABLE customer_payments
  ADD COLUMN IF NOT EXISTS verify_status TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS verify_reason TEXT,
  ADD COLUMN IF NOT EXISTS verified_cny NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS fee_cny NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS verified_on DATE,
  ADD COLUMN IF NOT EXISTS verified_by UUID,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_payments_verify_status_check') THEN
    ALTER TABLE customer_payments
      ADD CONSTRAINT customer_payments_verify_status_check
      CHECK (verify_status IN ('pending', 'confirmed', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_payments_verified_by_fkey') THEN
    ALTER TABLE customer_payments
      ADD CONSTRAINT customer_payments_verified_by_fkey
      FOREIGN KEY (verified_by) REFERENCES users(id);
  END IF;
END $$;

ALTER TABLE order_attachments
  ADD COLUMN IF NOT EXISTS payment_id UUID;

ALTER TABLE order_attachments DROP CONSTRAINT IF EXISTS order_attachments_kind_check;
ALTER TABLE order_attachments
  ADD CONSTRAINT order_attachments_kind_check
  CHECK (kind IN ('card', 'shipping_proof', 'payment_proof'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_attachments_payment_id_fkey') THEN
    ALTER TABLE order_attachments
      ADD CONSTRAINT order_attachments_payment_id_fkey
      FOREIGN KEY (payment_id) REFERENCES customer_payments(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS order_attachments_payment_id ON order_attachments(payment_id);
CREATE INDEX IF NOT EXISTS customer_payments_verify_status ON customer_payments(verify_status);
