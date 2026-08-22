DROP INDEX IF EXISTS "user".user_users_active_admin_idx;
DROP INDEX IF EXISTS "user".user_users_status_idx;

ALTER TABLE "user"."users"
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS blocked_at;
