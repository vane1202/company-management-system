-- Cancellation reverses the original booking day; it never creates a cash refund.
CREATE TABLE order_cancellations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id UUID NOT NULL REFERENCES orders(id),
 booked_on DATE NOT NULL,
 base_amount_cny NUMERIC(14,2) NOT NULL CHECK(base_amount_cny>0),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
 created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 voided_at TIMESTAMPTZ,
 voided_by UUID REFERENCES users(id) ON DELETE SET NULL,
 void_reason TEXT,
 CHECK((voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND void_reason IS NOT NULL AND length(trim(void_reason)) BETWEEN 1 AND 500))
);
CREATE UNIQUE INDEX order_cancellations_active ON order_cancellations(order_id) WHERE voided_at IS NULL;
