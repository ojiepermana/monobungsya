INSERT INTO "access"."permission" (
  name, code, namespace, resource, action, scope, description
) VALUES (
  'observability:telemetry:read',
  'OBSERVABILITY_TELEMETRY_READ',
  'observability',
  'telemetry',
  'read',
  NULL,
  'Read runtime telemetry'
)
ON CONFLICT (name) DO UPDATE SET
  code = EXCLUDED.code,
  namespace = EXCLUDED.namespace,
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  scope = EXCLUDED.scope,
  description = EXCLUDED.description,
  updated_at = now();

INSERT INTO "access"."permission_user" (permission_id, user_id)
SELECT legacy.id, grant_rows.user_id
FROM "access"."permission" AS legacy
CROSS JOIN (
  SELECT DISTINCT permission_user.user_id
  FROM "access"."permission_user" AS permission_user
  JOIN "access"."permission" AS replacement
    ON replacement.id = permission_user.permission_id
  WHERE replacement.name IN (
    'observability:trace:read',
    'observability:metric:read',
    'observability:benchmark:read',
    'observability:alert:read'
  )
) AS grant_rows
WHERE legacy.name = 'observability:telemetry:read'
ON CONFLICT (permission_id, user_id) DO NOTHING;

DELETE FROM "access"."permission"
WHERE name IN (
  'observability:trace:read',
  'observability:metric:read',
  'observability:benchmark:read',
  'observability:alert:read'
);
