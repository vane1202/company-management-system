ALTER TABLE users ADD COLUMN payroll_only boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD CONSTRAINT payroll_only_no_login
  CHECK (NOT payroll_only OR (NOT is_active AND account_kind = 'employee' AND role = 'assistant'));
