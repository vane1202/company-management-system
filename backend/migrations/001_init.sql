-- 公司内部管理系统初始结构
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE user_role AS ENUM (
  'boss',
  'admin',
  'ops',
  'editor',
  'cs',
  'cs_supervisor'
);

CREATE TYPE order_status AS ENUM (
  'placed',
  'in_production',
  'shipped',
  'refunded'
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role user_role NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_username_format CHECK (username ~ '^[a-z0-9][a-z0-9_-]{2,31}$')
);

CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  wechat_group_note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE team_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE,
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX team_memberships_user_dates
  ON team_memberships (user_id, start_date, end_date);
CREATE INDEX team_memberships_team_dates
  ON team_memberships (team_id, start_date, end_date);

CREATE TABLE supervisor_scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  is_explicit_cross_grant BOOLEAN NOT NULL DEFAULT FALSE,
  granted_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (supervisor_id, team_id)
);

CREATE TABLE fan_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id),
  business_date DATE NOT NULL,
  added_count INTEGER NOT NULL CHECK (added_count >= 0 AND added_count <= 1000000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, business_date)
);

CREATE TABLE fan_report_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES fan_reports(id) ON DELETE CASCADE,
  previous_count INTEGER NOT NULL,
  new_count INTEGER NOT NULL,
  changed_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ops_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  promo_video_count INTEGER NOT NULL CHECK (promo_video_count >= 0 AND promo_video_count <= 1000000),
  promo_cost NUMERIC(14, 2) NOT NULL CHECK (promo_cost >= 0),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, business_date, platform)
);

CREATE TABLE editor_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  shoot_count INTEGER NOT NULL CHECK (shoot_count >= 0 AND shoot_count <= 1000000),
  finished_count INTEGER NOT NULL CHECK (finished_count >= 0 AND finished_count <= 1000000),
  published_count INTEGER NOT NULL CHECK (published_count >= 0 AND published_count <= 1000000),
  inventory_snapshot INTEGER NOT NULL CHECK (inventory_snapshot >= 0 AND inventory_snapshot <= 10000000),
  inventory_adjusted BOOLEAN NOT NULL DEFAULT FALSE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, business_date)
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  order_ref TEXT NOT NULL,
  customer_label TEXT,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  status order_status NOT NULL DEFAULT 'placed',
  is_custom BOOLEAN NOT NULL DEFAULT FALSE,
  custom_product_cost NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (custom_product_cost >= 0),
  labor_cost NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (labor_cost >= 0),
  shipping_cost NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_ref),
  CONSTRAINT orders_ref_format CHECK (char_length(order_ref) BETWEEN 1 AND 64)
);

CREATE TABLE salaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  monthly_amount NUMERIC(14, 2) NOT NULL CHECK (monthly_amount >= 0),
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT salaries_no_overlap EXCLUDE USING gist (
    user_id WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
  )
);

CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_date DATE NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_data JSONB,
  after_data JSONB,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_entity ON audit_logs (entity_type, entity_id, created_at DESC);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO app_settings (key, value) VALUES ('fan_report_backfill_days', '3');

CREATE TABLE session (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IDX_session_expire ON session (expire);
