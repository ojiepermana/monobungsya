-- Spec docs/specs/0007-user-management: status becomes three nullable
-- timestamps on "user"."users". The effective status is derived with the
-- precedence deleted, then blocked, then suspended, then active, so the
-- existing suspended_at checks in the auth login queries extend instead of
-- being rewritten. A user row is never hard deleted; deleted_at marks it.
--
-- No new grant is needed: migration 0007_database_grants already gives
-- "project_user_runtime" SELECT, INSERT, UPDATE, DELETE on all tables in the
-- "user" schema, and an added column inherits the table level privilege.

ALTER TABLE "user"."users"
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

-- Serves the default list (deleted hidden) and the status filter.
CREATE INDEX IF NOT EXISTS user_users_status_idx
  ON "user"."users" (deleted_at, blocked_at, suspended_at);

-- Serves the last active admin guard, which counts admins whose three status
-- timestamps are all null inside the mutation's transaction.
CREATE INDEX IF NOT EXISTS user_users_active_admin_idx
  ON "user"."users" (role)
  WHERE suspended_at IS NULL
    AND blocked_at IS NULL
    AND deleted_at IS NULL;
