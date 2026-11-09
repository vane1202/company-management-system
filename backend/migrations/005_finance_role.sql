-- Separate migration so PostgreSQL commits the new enum value before it is used.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'finance';
