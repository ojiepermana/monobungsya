INSERT INTO "access"."permission_user" (permission_id, user_id)
SELECT permission.id, users.id
FROM "user"."users" AS users
JOIN regexp_split_to_table(
  coalesce(current_setting('app.access_bootstrap_admin_emails', true), ''),
  ','
) AS configured(value)
  ON lower(users.email) = lower(trim(configured.value))
JOIN "access"."permission" AS permission
  ON permission.name IN (
    'access:group:list',
    'access:group:read',
    'access:group:create',
    'access:group:update',
    'access:group:delete',
    'access:group:restore',
    'access:group:manage',
    'access:permission_group:list',
    'access:permission_group:create',
    'access:permission_group:delete',
    'access:permission_group:manage'
  )
WHERE trim(configured.value) <> ''
ON CONFLICT (permission_id, user_id) DO NOTHING;
