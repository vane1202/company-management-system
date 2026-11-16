-- Preparation only. No users are created or activated by this migration.
ALTER TABLE users ADD COLUMN ops_person_ref TEXT UNIQUE;
ALTER TABLE users ADD CONSTRAINT users_ops_person_ref_kind CHECK (
  ops_person_ref IS NULL OR
  (account_kind = 'employee' AND role = 'ops' AND person_ref IS NULL
   AND char_length(trim(ops_person_ref)) BETWEEN 1 AND 128)
);
ALTER TABLE users DROP CONSTRAINT users_username_format;
ALTER TABLE users ADD CONSTRAINT users_username_format CHECK (
  username ~ '^[a-z0-9][a-z0-9_-]{2,31}$' OR
  (account_kind = 'employee' AND ((role = 'cs' AND person_ref IS NOT NULL)
    OR (role = 'ops' AND ops_person_ref IS NOT NULL))
   AND username ~ '^[a-z0-9一-鿿㐀-䶿][a-z0-9一-鿿㐀-䶿_-]{0,31}$')
);
