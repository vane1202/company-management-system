-- Express shipping screenshots stay on the order, apart from card photos.
ALTER TABLE order_attachments
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'card';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_attachments_kind_check') THEN
    ALTER TABLE order_attachments
      ADD CONSTRAINT order_attachments_kind_check CHECK (kind IN ('card', 'shipping_proof'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS order_attachments_order_kind ON order_attachments(order_id, kind);
