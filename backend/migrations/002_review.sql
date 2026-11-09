-- 助理审核：日常填报增加待审/通过/退回。已有数据一律视为待审，不自动通过。
-- 升级前请先备份数据库（scripts/backup.sh 为明文 pg_dump）。本文件不修改 001_init.sql。

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'assistant';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'review_status') THEN
    CREATE TYPE review_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END
$$;

ALTER TABLE fan_reports
  ADD COLUMN IF NOT EXISTS review_status review_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS review_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_submitted_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_reason TEXT;

ALTER TABLE ops_reports
  ADD COLUMN IF NOT EXISTS review_status review_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS review_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_submitted_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_reason TEXT;

ALTER TABLE editor_reports
  ADD COLUMN IF NOT EXISTS review_status review_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS review_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_submitted_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_reason TEXT;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS review_status review_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS review_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_submitted_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_reason TEXT;

UPDATE fan_reports SET last_submitted_by = user_id WHERE last_submitted_by IS NULL;
UPDATE ops_reports SET last_submitted_by = user_id WHERE last_submitted_by IS NULL;
UPDATE editor_reports SET last_submitted_by = user_id WHERE last_submitted_by IS NULL;
UPDATE orders SET last_submitted_by = user_id WHERE last_submitted_by IS NULL;

-- 明确已有数据为待审，避免升级后被当成已通过
UPDATE fan_reports SET review_status = 'pending' WHERE review_status IS DISTINCT FROM 'pending' AND reviewed_at IS NULL AND review_version = 1;
UPDATE ops_reports SET review_status = 'pending' WHERE review_status IS DISTINCT FROM 'pending' AND reviewed_at IS NULL AND review_version = 1;
UPDATE editor_reports SET review_status = 'pending' WHERE review_status IS DISTINCT FROM 'pending' AND reviewed_at IS NULL AND review_version = 1;
UPDATE orders SET review_status = 'pending' WHERE review_status IS DISTINCT FROM 'pending' AND reviewed_at IS NULL AND review_version = 1;

CREATE TABLE IF NOT EXISTS review_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  review_version INTEGER NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  actor_id UUID NOT NULL REFERENCES users(id),
  before_status review_status,
  after_status review_status,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT review_actions_entity_type_check CHECK (
    entity_type IN ('ops_report', 'editor_report', 'fan_report', 'order')
  ),
  CONSTRAINT review_actions_action_check CHECK (
    action IN ('approved', 'rejected', 'resubmitted')
  )
);

CREATE INDEX IF NOT EXISTS review_actions_entity_idx
  ON review_actions (entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS fan_reports_review_idx
  ON fan_reports (review_status, business_date);
CREATE INDEX IF NOT EXISTS ops_reports_review_idx
  ON ops_reports (review_status, business_date);
CREATE INDEX IF NOT EXISTS editor_reports_review_idx
  ON editor_reports (review_status, business_date);
CREATE INDEX IF NOT EXISTS orders_review_idx
  ON orders (review_status, business_date);
