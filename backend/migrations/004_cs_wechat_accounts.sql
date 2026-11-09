-- 固定客服微信作为填报主体；旧员工及历史业务归属不重分配。
ALTER TABLE users
  ADD COLUMN account_kind TEXT NOT NULL DEFAULT 'employee',
  ADD COLUMN wechat_id TEXT,
  ADD COLUMN phone_label TEXT,
  ADD COLUMN device_version INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT users_account_kind_check CHECK (account_kind IN ('employee', 'cs_wechat')),
  ADD CONSTRAINT users_device_version_check CHECK (device_version >= 0),
  ADD CONSTRAINT users_cs_wechat_check CHECK (
    (account_kind = 'employee' AND wechat_id IS NULL) OR
    (account_kind = 'cs_wechat' AND role = 'cs' AND wechat_id IS NOT NULL AND char_length(wechat_id) BETWEEN 6 AND 64)
  );
CREATE UNIQUE INDEX users_wechat_id_unique ON users (lower(wechat_id)) WHERE wechat_id IS NOT NULL;

CREATE TABLE cs_registration_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash TEXT NOT NULL UNIQUE,
  team_id UUID NOT NULL REFERENCES teams(id),
  bound_user_id UUID REFERENCES users(id),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_by UUID REFERENCES users(id),
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);
