/**
 * E2E fixture seeder, run with bun (never imported by Playwright directly).
 * Creates two users, a fresh magic-link token for each, and
 * enough tagged log rows to exercise paging. Prints one JSON line to stdout:
 * { adminToken, staffToken }. cleanup.ts removes everything created here.
 */
import { createHash, randomBytes } from 'node:crypto';
import { closeDatabaseClient, createDatabaseClient } from '#project/database';
import { ActivityLog } from '#project/logger';

const db = createDatabaseClient(
  process.env.DATABASE_URL ?? 'postgres://root@127.0.0.1:5432/monobungsia',
);

async function mintToken(email: string, label: string): Promise<string> {
  const [user] = await db`
    INSERT INTO "user"."users" (name, email, email_verified_at)
    VALUES (${`E2E ${label}`}, ${email}, now())
    ON CONFLICT (email) DO UPDATE
      SET name = EXCLUDED.name,
          email_verified_at = EXCLUDED.email_verified_at,
          updated_at = now()
    RETURNING id
  `;
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token, 'utf8').digest('hex');
  await db`
    INSERT INTO "auth"."login_tokens" (user_id, token_hash, expires_at)
    VALUES (${user.id}, ${hash}, now() + interval '15 minutes')
  `;
  return token;
}

// Idempotent: a crashed earlier run may have left rows behind.
await db`DELETE FROM logs.logging WHERE module = 'e2e'`;
await db`DELETE FROM logs.audit_trails WHERE module = 'e2e'`;
await db`DELETE FROM logs.access_logs WHERE guard = 'e2e'`;

const adminToken = await mintToken('e2e-admin@local.test', 'admin');
const staffToken = await mintToken('e2e-staff@local.test', 'staff');
const [adminUser] = await db`
  SELECT id
  FROM "user"."users"
  WHERE email = 'e2e-admin@local.test'
  LIMIT 1
`;

await db`
  INSERT INTO "access"."permission" (
    name, code, namespace, resource, action, scope, description
  )
  VALUES
    ('user:user:manage', 'USER_USER_MANAGE', 'user', 'user', 'manage', NULL, 'Manage users'),
    ('logs:log:read', 'LOGS_LOG_READ', 'logs', 'log', 'read', NULL, 'Read logs'),
    ('jobs:job:list', 'JOBS_JOB_LIST', 'jobs', 'job', 'list', NULL, 'List jobs'),
    ('jobs:job:read', 'JOBS_JOB_READ', 'jobs', 'job', 'read', NULL, 'Read jobs'),
    ('jobs:job:retry', 'JOBS_JOB_RETRY', 'jobs', 'job', 'retry', NULL, 'Retry jobs'),
    ('jobs:job:manage', 'JOBS_JOB_MANAGE', 'jobs', 'job', 'manage', NULL, 'Manage jobs'),
    ('observability:telemetry:read', 'OBSERVABILITY_TELEMETRY_READ', 'observability', 'telemetry', 'read', NULL, 'Read observability evidence')
  ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      namespace = EXCLUDED.namespace,
      resource = EXCLUDED.resource,
      action = EXCLUDED.action,
      scope = EXCLUDED.scope,
      description = EXCLUDED.description,
      updated_at = now()
`;

await db`
  INSERT INTO "access"."permission" (
    name, code, namespace, resource, action, scope, description
  )
  VALUES (
    'access:permission:list',
    'ACCESS_PERMISSION_LIST',
    'access',
    'permission',
    'list',
    NULL,
    'List permissions'
  )
  ON CONFLICT (code) DO NOTHING
`;

await db`
  INSERT INTO "access"."permission_user" (permission_id, user_id)
  SELECT permission.id, ${adminUser.id}
  FROM "access"."permission" AS permission
  WHERE permission.name IN (
    'logs:log:read',
    'user:user:manage',
    'jobs:job:list',
    'jobs:job:read',
    'jobs:job:retry',
    'jobs:job:manage',
    'observability:telemetry:read',
    'access:group:list',
    'access:group:read',
    'access:group:create',
    'access:group:update',
    'access:group:delete',
    'access:group:restore',
    'access:permission_group:list',
    'access:permission_group:create',
    'access:permission_group:delete',
    'access:permission_user:create'
  )
  ON CONFLICT (permission_id, user_id) DO NOTHING
`;

await db`
  INSERT INTO notification.recipient_projection (
    user_id, display_name, email, active, can_read_jobs, can_read_observability
  )
  VALUES (${adminUser.id}, 'E2E admin', 'e2e-admin@local.test', true, true, true)
  ON CONFLICT (user_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    email = EXCLUDED.email,
    active = EXCLUDED.active,
    can_read_jobs = EXCLUDED.can_read_jobs,
    can_read_observability = EXCLUDED.can_read_observability
`;

await db`
  INSERT INTO "access"."permission_user" (permission_id, user_id)
  SELECT permission.id, ${adminUser.id}
  FROM "access"."permission" AS permission
  WHERE permission.name = 'access:permission:list'
  ON CONFLICT (permission_id, user_id) DO NOTHING
`;

ActivityLog.configure(db);

// 30 application rows: more than one 25-row page, so paging is walkable.
for (let i = 1; i <= 30; i++) {
  ActivityLog.writeLog({
    level: i % 3 === 0 ? 'error' : i % 2 === 0 ? 'warning' : 'info',
    message: `e2e seed row ${i}`,
    module: 'e2e',
    event: 'e2e.seed',
  });
}
await ActivityLog.writeAudit({
  action: 'create',
  module: 'e2e',
  entityType: 'E2EEntity',
  entityId: 'e2e-1',
  changeSummary: 'e2e seeded audit row',
});
ActivityLog.writeAccess({
  event: 'sign_in',
  guard: 'e2e',
  authenticationMethod: 'magic_link',
});
ActivityLog.writeAccess({ event: 'sign_out', guard: 'e2e' });
await ActivityLog.flush();

console.log(JSON.stringify({ adminToken, staffToken }));
await closeDatabaseClient(db);
