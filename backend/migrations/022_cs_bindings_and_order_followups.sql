CREATE TABLE cs_device_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES users(id),
  employee_id UUID NOT NULL REFERENCES users(id),
  browser_key TEXT NOT NULL,
  label TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'active', 'closed')),
  device_version INTEGER,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
  UNIQUE (account_id, browser_key)
);
CREATE UNIQUE INDEX cs_device_binding_active ON cs_device_bindings(account_id) WHERE state = 'active';

CREATE TABLE supervisor_order_followups (
  order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  next_contact_on DATE,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
