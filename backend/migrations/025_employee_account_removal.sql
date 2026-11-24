ALTER TABLE users ADD COLUMN employee_removed_at timestamptz;
ALTER TABLE users ADD CONSTRAINT removed_employee_is_inactive
  CHECK (employee_removed_at IS NULL OR (account_kind = 'employee' AND NOT is_active));
