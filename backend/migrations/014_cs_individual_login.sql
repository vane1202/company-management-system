-- Preparation only: no employee accounts are created and no login is enabled.
ALTER TABLE users ADD COLUMN person_ref TEXT UNIQUE;
ALTER TABLE users ADD CONSTRAINT users_person_ref_kind CHECK (
  person_ref IS NULL OR
  (account_kind = 'employee' AND role = 'cs' AND char_length(trim(person_ref)) BETWEEN 1 AND 128)
);
ALTER TABLE users DROP CONSTRAINT users_username_format;
ALTER TABLE users ADD CONSTRAINT users_username_format CHECK (
  username ~ '^[a-z0-9][a-z0-9_-]{2,31}$' OR
  (person_ref IS NOT NULL AND account_kind = 'employee' AND role = 'cs'
   AND username ~ '^[a-z0-9一-鿿㐀-䶿][a-z0-9一-鿿㐀-䶿_-]{0,31}$')
);
