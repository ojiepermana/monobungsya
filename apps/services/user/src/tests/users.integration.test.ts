import { describe, expect, spyOn, test } from 'bun:test';
import { loadEnv } from '#project/config';
import { signAuthIdentity } from '#project/contracts';
import { closeDatabaseClient, createDatabaseClient } from '#project/database';
import { ActivityLog } from '#project/logger';
import { createApp } from '../app';

const databaseUrl = Bun.env.DATABASE_URL;
const SIGNING_SECRET = 'user-integration-signing-secret';
const ADMIN_ID = '0198f8a0-0000-7000-8000-000000000001';
const PROBE_EMAIL = 'audit-rollback.integration@local.test';

function signedHeaders(method: string, path: string): Record<string, string> {
  const identity = {
    userId: ADMIN_ID,
    email: 'system@project.local',
    permissions: ['user:user:manage'],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };

  return {
    'content-type': 'application/json',
    'x-auth-user-id': identity.userId,
    'x-auth-email': identity.email,
    'x-auth-permissions': identity.permissions.join(','),
    'x-auth-expires-at': identity.expiresAt,
    'x-auth-signature': signAuthIdentity(
      method,
      path,
      identity,
      SIGNING_SECRET,
    ),
  };
}

/**
 * Covers spec docs/specs/0007-user-management AC-7: "A failed audit write fails
 * the request." The guarantee is that the audit write is the last statement
 * inside the mutation's transaction, so if it throws the mutation rolls back
 * with it. Only a real database can show that, because the rollback is
 * Postgres doing the work, not application code.
 *
 * Needs DATABASE_URL, and skips itself when there is none, matching the auth
 * integration test.
 */
describe('user audit trail integration', () => {
  test('a failed audit write rolls the create back', async () => {
    if (!databaseUrl) {
      return;
    }

    const database = createDatabaseClient(databaseUrl);
    ActivityLog.configure(database);
    const app = createApp(
      loadEnv('user', {
        NODE_ENV: 'test',
        PORT: '3102',
        DATABASE_URL: databaseUrl,
        INTERNAL_AUTH_SIGNING_SECRET: SIGNING_SECRET,
      }),
      { database },
    );
    const countProbeRows = async (): Promise<number> => {
      const rows = (await database`
        SELECT count(*)::int AS total
        FROM "user"."users"
        WHERE email = ${PROBE_EMAIL}
      `) as Array<{ total: number }>;

      return Number(rows[0]?.total ?? 0);
    };

    try {
      await database`DELETE FROM "user"."users" WHERE email = ${PROBE_EMAIL}`;

      // The audit write fails, so the create it belongs to must not survive.
      const failing = spyOn(ActivityLog, 'writeAudit').mockImplementation(() =>
        Promise.reject(new Error('audit trail unavailable')),
      );
      let rolledBack: Response;

      try {
        rolledBack = await app.handle(
          new Request('http://localhost/internal/users', {
            method: 'POST',
            headers: signedHeaders('POST', '/internal/users'),
            body: JSON.stringify({
              id: Bun.randomUUIDv7(),
              name: 'Audit Rollback Probe',
              email: PROBE_EMAIL,
            }),
          }),
        );
      } finally {
        failing.mockRestore();
      }

      expect(rolledBack.status).not.toBe(200);
      expect(await countProbeRows()).toBe(0);

      // Positive control: the very same request succeeds once the audit write
      // works again, so the rollback above was caused by the failure and not by
      // something else in the request.
      const succeeding = await app.handle(
        new Request('http://localhost/internal/users', {
          method: 'POST',
          headers: signedHeaders('POST', '/internal/users'),
          body: JSON.stringify({
            id: Bun.randomUUIDv7(),
            name: 'Audit Rollback Probe',
            email: PROBE_EMAIL,
          }),
        }),
      );

      expect(succeeding.status).toBe(200);
      expect(await countProbeRows()).toBe(1);
    } finally {
      await database`
        DELETE FROM "logs"."audit_trails"
        WHERE module = 'users' AND entity_label = ${PROBE_EMAIL}
      `;
      await database`DELETE FROM "user"."users" WHERE email = ${PROBE_EMAIL}`;
      await closeDatabaseClient(database);
    }
  });
});
