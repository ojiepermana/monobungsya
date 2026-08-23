ALTER TABLE "user"."users"
  ADD COLUMN IF NOT EXISTS role varchar(50) NOT NULL DEFAULT 'bi';

ALTER TABLE "user"."users"
  ADD CONSTRAINT user_users_role_check
  CHECK (role IN ('admin', 'manager', 'bi', 'staff', 'legacy'));

CREATE INDEX IF NOT EXISTS user_users_active_admin_idx
  ON "user"."users" (role)
  WHERE suspended_at IS NULL
    AND blocked_at IS NULL
    AND deleted_at IS NULL;
