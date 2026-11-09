-- 007：月度工资单的财务手工项目（提成 / 奖金 / 扣款）与员工-月份锁定状态。
-- 只追加新表，不修改 001-006，不改动 salaries 原有工资标准与分摊规则。
-- 系统不自动计算提成、奖金、扣款；全部由财务按员工、按自然月逐条录入，金额为正数，扣款在核算时减去。

CREATE TABLE payroll_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  pay_month TEXT NOT NULL CHECK (pay_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  kind TEXT NOT NULL CHECK (kind IN ('commission','bonus','deduction')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  note TEXT NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 500),
  request_key UUID NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  corrects_id UUID UNIQUE REFERENCES payroll_items(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES users(id),
  void_reason TEXT,
  CHECK ((voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
      OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(btrim(void_reason)) BETWEEN 1 AND 500))
);
CREATE INDEX payroll_items_month ON payroll_items (pay_month, user_id);

CREATE TABLE payroll_months (
  user_id UUID NOT NULL REFERENCES users(id),
  pay_month TEXT NOT NULL CHECK (pay_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status TEXT NOT NULL CHECK (status IN ('draft','locked')),
  version INTEGER NOT NULL DEFAULT 1,
  -- 锁定时的金额快照（人民币，分精度），用于发现锁定后工资标准被调整的情况。
  locked_base NUMERIC(14,2),
  locked_commission NUMERIC(14,2),
  locked_bonus NUMERIC(14,2),
  locked_deduction NUMERIC(14,2),
  locked_net NUMERIC(14,2),
  locked_at TIMESTAMPTZ,
  locked_by UUID REFERENCES users(id),
  updated_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pay_month),
  CHECK ((status = 'draft') OR (locked_at IS NOT NULL AND locked_by IS NOT NULL AND locked_base IS NOT NULL
      AND locked_commission IS NOT NULL AND locked_bonus IS NOT NULL AND locked_deduction IS NOT NULL AND locked_net IS NOT NULL))
);

-- Windows 本地安装：迁移由表所有者执行，应用账号 cuiguanjia_app 只需读写，不授予 DELETE。
-- 其他环境不存在该角色时跳过。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cuiguanjia_app') THEN
    GRANT SELECT, INSERT, UPDATE ON payroll_items, payroll_months TO cuiguanjia_app;
  END IF;
END
$$;
