/**
 * E2E fixture cleanup, run with bun after the suite. Removes every row that
 * seed.ts created: tagged log rows, the two e2e users, and their sessions
 * and login tokens.
 */
import { closeDatabaseClient, createDatabaseClient } from '#project/database';

const db = createDatabaseClient(
  process.env.DATABASE_URL ?? 'postgres://root@127.0.0.1:5432/monobungsia',
);

await db`DELETE FROM logs.logging WHERE module = 'e2e'`;
await db`DELETE FROM logs.audit_trails WHERE module = 'e2e'`;
await db`DELETE FROM logs.access_logs WHERE guard = 'e2e'`;
await db`
  DELETE FROM "auth"."sessions"
  WHERE user_id IN (
    SELECT id FROM "user"."users" WHERE email LIKE 'e2e-%@local.test'
  )
`;
await db`
  DELETE FROM "auth"."login_tokens"
  WHERE user_id IN (
    SELECT id FROM "user"."users" WHERE email LIKE 'e2e-%@local.test'
  )
`;
await db`DELETE FROM "user"."users" WHERE email LIKE 'e2e-%@local.test'`;

await closeDatabaseClient(db);
