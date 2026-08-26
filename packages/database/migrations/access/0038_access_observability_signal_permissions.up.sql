INSERT INTO "access"."permission" (
  name, code, namespace, resource, action, scope, description
) VALUES
  ('observability:trace:read', 'OBSERVABILITY_TRACE_READ', 'observability', 'trace', 'read', NULL, 'Read runtime traces'),
  ('observability:metric:read', 'OBSERVABILITY_METRIC_READ', 'observability', 'metric', 'read', NULL, 'Read runtime metrics'),
  ('observability:benchmark:read', 'OBSERVABILITY_BENCHMARK_READ', 'observability', 'benchmark', 'read', NULL, 'Read benchmark evidence'),
  ('observability:alert:read', 'OBSERVABILITY_ALERT_READ', 'observability', 'alert', 'read', NULL, 'Read runtime alerts')
ON CONFLICT (name) DO UPDATE SET
  code = EXCLUDED.code,
  namespace = EXCLUDED.namespace,
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  scope = EXCLUDED.scope,
  description = EXCLUDED.description,
  updated_at = now();

INSERT INTO "access"."permission_user" (permission_id, user_id)
SELECT replacement.id, grant_rows.user_id
FROM "access"."permission" AS legacy
JOIN "access"."permission_user" AS grant_rows
  ON grant_rows.permission_id = legacy.id
CROSS JOIN "access"."permission" AS replacement
WHERE legacy.name = 'observability:telemetry:read'
  AND replacement.name IN (
    'observability:trace:read',
    'observability:metric:read',
    'observability:benchmark:read',
    'observability:alert:read'
  )
ON CONFLICT (permission_id, user_id) DO NOTHING;

DELETE FROM "access"."permission"
WHERE name = 'observability:telemetry:read';
