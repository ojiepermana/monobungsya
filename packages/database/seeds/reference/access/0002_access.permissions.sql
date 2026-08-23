INSERT INTO "access"."permission" (
  name,
  code,
  namespace,
  resource,
  action,
  scope,
  description
)
VALUES
  ('user:user:list', 'USER_USER_LIST', 'user', 'user', 'list', NULL, 'List users'),
  ('user:user:read', 'USER_USER_READ', 'user', 'user', 'read', NULL, 'Read a user'),
  ('user:user:create', 'USER_USER_CREATE', 'user', 'user', 'create', NULL, 'Create users'),
  ('user:user:update', 'USER_USER_UPDATE', 'user', 'user', 'update', NULL, 'Update user profiles'),
  ('user:user:suspend', 'USER_USER_SUSPEND', 'user', 'user', 'suspend', NULL, 'Suspend users'),
  ('user:user:block', 'USER_USER_BLOCK', 'user', 'user', 'block', NULL, 'Block users'),
  ('user:user:delete', 'USER_USER_DELETE', 'user', 'user', 'delete', NULL, 'Soft delete users'),
  ('user:user:restore', 'USER_USER_RESTORE', 'user', 'user', 'restore', NULL, 'Restore users'),
  ('user:user:manage', 'USER_USER_MANAGE', 'user', 'user', 'manage', NULL, 'Manage users'),
  ('logs:log:read', 'LOGS_LOG_READ', 'logs', 'log', 'read', NULL, 'Read logs'),
  ('access:permission:list', 'ACCESS_PERMISSION_LIST', 'access', 'permission', 'list', NULL, 'List permissions'),
  ('access:permission:read', 'ACCESS_PERMISSION_READ', 'access', 'permission', 'read', NULL, 'Read a permission'),
  ('access:permission:create', 'ACCESS_PERMISSION_CREATE', 'access', 'permission', 'create', NULL, 'Create permissions'),
  ('access:permission:update', 'ACCESS_PERMISSION_UPDATE', 'access', 'permission', 'update', NULL, 'Update permission descriptions'),
  ('access:permission:delete', 'ACCESS_PERMISSION_DELETE', 'access', 'permission', 'delete', NULL, 'Delete permissions'),
  ('access:permission:manage', 'ACCESS_PERMISSION_MANAGE', 'access', 'permission', 'manage', NULL, 'Manage permissions'),
  ('access:permission_user:list', 'ACCESS_PERMISSION_USER_LIST', 'access', 'permission_user', 'list', NULL, 'List user grants'),
  ('access:permission_user:create', 'ACCESS_PERMISSION_USER_CREATE', 'access', 'permission_user', 'create', NULL, 'Grant permissions to users'),
  ('access:permission_user:delete', 'ACCESS_PERMISSION_USER_DELETE', 'access', 'permission_user', 'delete', NULL, 'Revoke permissions from users'),
  ('access:permission_user:manage', 'ACCESS_PERMISSION_USER_MANAGE', 'access', 'permission_user', 'manage', NULL, 'Manage user grants')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    namespace = EXCLUDED.namespace,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    scope = EXCLUDED.scope,
    description = EXCLUDED.description,
    updated_at = now();

DO $$
DECLARE
  configured_email text;
  matched_count integer;
BEGIN
  FOR configured_email IN
    SELECT lower(trim(value))
    FROM regexp_split_to_table(
      coalesce(current_setting('app.access_bootstrap_admin_emails', true), ''),
      ','
    ) AS value
    WHERE trim(value) <> ''
  LOOP
    SELECT count(*) INTO matched_count
    FROM "user"."users"
    WHERE lower(email) = configured_email;

    IF matched_count = 0 THEN
      RAISE WARNING 'ACCESS_BOOTSTRAP_ADMIN_EMAILS email has no matching user row: %', configured_email;
    END IF;
  END LOOP;
END
$$;

INSERT INTO "access"."permission_user" (permission_id, user_id)
SELECT permission.id, users.id
FROM "user"."users" AS users
JOIN regexp_split_to_table(
  coalesce(current_setting('app.access_bootstrap_admin_emails', true), ''),
  ','
) AS configured(value)
  ON lower(users.email) = lower(trim(configured.value))
CROSS JOIN "access"."permission" AS permission
WHERE trim(configured.value) <> ''
ON CONFLICT (permission_id, user_id) DO NOTHING;
