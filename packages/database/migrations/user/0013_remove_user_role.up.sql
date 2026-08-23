DROP INDEX IF EXISTS "user".user_users_active_admin_idx;

ALTER TABLE "user"."users"
  DROP CONSTRAINT IF EXISTS user_users_role_check,
  DROP COLUMN IF EXISTS role;
