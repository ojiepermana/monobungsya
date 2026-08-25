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
