INSERT INTO "access"."permission" (
  name, code, namespace, resource, action, scope, description
) VALUES
  ('jobs:job:list', 'JOBS_JOB_LIST', 'jobs', 'job', 'list', NULL, 'List jobs'),
  ('jobs:job:read', 'JOBS_JOB_READ', 'jobs', 'job', 'read', NULL, 'Read job details'),
  ('jobs:job:retry', 'JOBS_JOB_RETRY', 'jobs', 'job', 'retry', NULL, 'Retry failed jobs'),
  ('jobs:job:manage', 'JOBS_JOB_MANAGE', 'jobs', 'job', 'manage', NULL, 'Manage jobs')
ON CONFLICT (name) DO UPDATE SET
  code = EXCLUDED.code,
  namespace = EXCLUDED.namespace,
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  scope = EXCLUDED.scope,
  description = EXCLUDED.description,
  updated_at = now();
