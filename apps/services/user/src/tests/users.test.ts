import { describe, expect, it, spyOn } from 'bun:test';
import { loadEnv } from '#project/config';
import { signAuthIdentity } from '#project/contracts';
import type { DatabaseClient } from '#project/database';
import {
  authSendUserInvitationContract,
  JobRegistry,
  notificationRecipientSyncContract,
} from '#project/jobs';
import { ActivityLog, Logger } from '#project/logger';
import type { Publisher } from '#project/messaging';
import { createApp } from '../app';
import { UsersRepository } from '../modules/users/repository/users.repository';
import { UsersService } from '../modules/users/users.service';
import type { UserStatusFilter } from '../modules/users/users.types';

interface RecordedQuery {
  text: string;
  params: unknown[];
}

/**
 * Each call to `.unsafe()` consumes the next canned response off the queue, in
 * the exact order the repository issues its queries. `.begin()` hands the same
 * fake back as the transaction executor, matching `withTransaction`, which
 * calls `database.begin(async (transaction) => operation(transaction))`: a
 * rejection inside `operation` propagates out of `.begin()` unchanged, the same
 * shape a real rolled back transaction rejects with.
 */
function createFakeDatabase(responses: unknown[][]): {
  database: DatabaseClient;
  queries: RecordedQuery[];
} {
  const queue = [...responses];
  const queries: RecordedQuery[] = [];
  const fake = {
    unsafe(text: string, params: unknown[] = []) {
      queries.push({ text, params });

      return Promise.resolve(queue.shift() ?? []);
    },
    begin(operation: (transaction: DatabaseClient) => Promise<unknown>) {
      return operation(fake as unknown as DatabaseClient);
    },
  };

  return { database: fake as unknown as DatabaseClient, queries };
}

function createDurableFakeDatabase(responses: unknown[][]): {
  database: DatabaseClient;
  enqueueQueries: string[];
} {
  const queue = [...responses];
  const enqueueQueries: string[] = [];
  const fake = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      enqueueQueries.push(
        strings.raw
          .map((part, index) => `${part}${values[index] ?? ''}`)
          .join(''),
      );
      return [{ id: NEW_USER_ID, status: 'queued' }];
    },
    {
      unsafe(_text: string, _params: unknown[] = []) {
        return Promise.resolve(queue.shift() ?? []);
      },
      begin(operation: (transaction: DatabaseClient) => Promise<unknown>) {
        return operation(fake as unknown as DatabaseClient);
      },
    },
  );

  return {
    database: fake as unknown as DatabaseClient,
    enqueueQueries,
  };
}

const SECRET = 'user-service-signing-secret';
const EXPIRES_AT = new Date(Date.now() + 60_000).toISOString();
const ADMIN_ID = '0198f8a0-0000-7000-8000-000000000001';
const ADMIN_EMAIL = 'admin@project.local';
const TARGET_ID = '0198f8a0-0000-7000-8000-0000000000b1';
const NEW_USER_ID = '0198f8a0-0000-7000-8000-0000000000c1';

const ADMIN_IDENTITY = {
  userId: ADMIN_ID,
  email: ADMIN_EMAIL,
  permissions: ['user:user:manage'],
  expiresAt: EXPIRES_AT,
};
const MANAGER_IDENTITY = {
  userId: '0198f8a0-0000-7000-8000-0000000000d1',
  email: 'manager@project.local',
  permissions: [],
  expiresAt: EXPIRES_AT,
};

/** Snake_case row matching what `mapUser` expects to read back from Postgres. */
function dbRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TARGET_ID,
    name: 'Jane Staff',
    email: 'jane.staff@project.local',
    email_verified_at: null,
    suspended_at: null,
    blocked_at: null,
    deleted_at: null,
    created_at: '2026-08-22 09:00:00.000',
    updated_at: null,
    ...overrides,
  };
}

const ACTOR_ROW = dbRow({
  id: ADMIN_ID,
  name: 'Admin One',
  email: ADMIN_EMAIL,
});

function testEnv(extra: Record<string, string> = {}) {
  return loadEnv('user', {
    NODE_ENV: 'test',
    PORT: '3102',
    INTERNAL_AUTH_SIGNING_SECRET: SECRET,
    ...extra,
  });
}

function appWithDb(
  database: DatabaseClient,
  extra: { messaging?: Publisher } = {},
) {
  return createApp(testEnv(), { database, ...extra });
}

interface SignableIdentity {
  userId: string;
  email: string;
  permissions: string[];
  expiresAt: string;
}

function signedRequest(
  method: string,
  path: string,
  identity: SignableIdentity,
  body?: unknown,
): Request {
  // The signature covers only the pathname: the server verifies against
  // `new URL(request.url).pathname`, which never includes the query string.
  const pathname = new URL(path, 'http://localhost').pathname;
  const signature = signAuthIdentity(method, pathname, identity, SECRET);

  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      'x-auth-user-id': identity.userId,
      'x-auth-email': identity.email,
      'x-auth-permissions': identity.permissions.join(','),
      'x-auth-expires-at': identity.expiresAt,
      'x-auth-signature': signature,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const CREATE_USER_BODY = {
  id: NEW_USER_ID,
  name: 'New User',
  email: 'new.user@project.local',
} as const;

describe('user service', () => {
  it('exposes health and protects module status with its read permission', async () => {
    const app = createApp(loadEnv('user', { NODE_ENV: 'test', PORT: '3102' }));
    const health = await app.handle(new Request('http://localhost/health'));
    const moduleStatus = await app.handle(
      new Request('http://localhost/internal/users/status'),
    );

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', service: 'user' });
    expect(moduleStatus.status).toBe(401);
  });

  it('rejects unsigned internal requests when identity signing is enabled', async () => {
    const secret = 'user-service-signing-secret';
    const app = createApp(
      loadEnv('user', {
        NODE_ENV: 'test',
        PORT: '3102',
        INTERNAL_AUTH_SIGNING_SECRET: secret,
      }),
    );
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const identity = {
      userId: '0198f8a0-0000-7000-8000-000000000001',
      email: 'system@project.local',
      permissions: ['user:user:manage'],
      expiresAt,
    };
    const signature = signAuthIdentity(
      'GET',
      '/internal/users/status',
      identity,
      secret,
    );

    const unsigned = await app.handle(
      new Request('http://localhost/internal/users/status'),
    );
    expect(unsigned.status).toBe(401);

    const denied = await app.handle(
      signedRequest('GET', '/internal/users/status', {
        ...identity,
        permissions: [],
      }),
    );
    expect(denied.status).toBe(403);

    const signed = await app.handle(
      new Request('http://localhost/internal/users/status', {
        headers: {
          'x-auth-user-id': identity.userId,
          'x-auth-email': identity.email,
          'x-auth-permissions': identity.permissions.join(','),
          'x-auth-expires-at': identity.expiresAt,
          'x-auth-signature': signature,
        },
      }),
    );
    expect(signed.status).toBe(200);
  });

  it('refuses a manager on a mutation route the same as the read route (AC-8)', async () => {
    const { database } = createFakeDatabase([]);
    const app = appWithDb(database);

    const response = await app.handle(
      signedRequest(
        'POST',
        '/internal/users',
        MANAGER_IDENTITY,
        CREATE_USER_BODY,
      ),
    );

    expect(response.status).toBe(403);
  });
});

describe('users create (spec docs/specs/0007-user-management, AC-1, AC-2, AC-7)', () => {
  let writeAuditSpy: ReturnType<typeof spyOn>;

  const setup = (extra: { messaging?: Publisher } = {}) => {
    writeAuditSpy = spyOn(ActivityLog, 'writeAudit').mockResolvedValue(
      undefined as never,
    );

    return extra;
  };

  const teardown = () => writeAuditSpy.mockRestore();

  it('creates a user and returns it as active', async () => {
    setup();
    try {
      const { database } = createFakeDatabase([
        [], // findCreateConflict: no collision
        [dbRow({ ...CREATE_USER_BODY })], // insert
        [ACTOR_ROW], // writeAudit's actor name lookup
      ]);
      const app = appWithDb(database);

      const response = await app.handle(
        signedRequest(
          'POST',
          '/internal/users',
          ADMIN_IDENTITY,
          CREATE_USER_BODY,
        ),
      );
      const body = (await response.json()) as { id: string; status: string };

      expect(response.status).toBe(200);
      expect(body.id).toBe(NEW_USER_ID);
      expect(body.status).toBe('active');
      expect(writeAuditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'create',
          module: 'users',
          entityId: NEW_USER_ID,
          statusBefore: null,
          statusAfter: 'active',
          actor: expect.objectContaining({ id: ADMIN_ID, email: ADMIN_EMAIL }),
        }),
      );
    } finally {
      teardown();
    }
  });

  it('returns 409 user_id_taken for a duplicate id', async () => {
    setup();
    try {
      const { database } = createFakeDatabase([
        [{ id: NEW_USER_ID, email: 'someone-else@project.local' }],
      ]);
      const app = appWithDb(database);

      const response = await app.handle(
        signedRequest(
          'POST',
          '/internal/users',
          ADMIN_IDENTITY,
          CREATE_USER_BODY,
        ),
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: 'CONFLICT', reason: 'user_id_taken' },
      });
    } finally {
      teardown();
    }
  });

  it('returns 409 user_email_taken for a duplicate email, distinct from a duplicate id', async () => {
    setup();
    try {
      const { database } = createFakeDatabase([
        [{ id: 'a-completely-different-id', email: CREATE_USER_BODY.email }],
      ]);
      const app = appWithDb(database);

      const response = await app.handle(
        signedRequest(
          'POST',
          '/internal/users',
          ADMIN_IDENTITY,
          CREATE_USER_BODY,
        ),
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: 'CONFLICT', reason: 'user_email_taken' },
      });
    } finally {
      teardown();
    }
  });

  it('publishes a user.invited event after the create commits (AC-2)', async () => {
    setup();
    try {
      const { database } = createFakeDatabase([
        [],
        [dbRow({ ...CREATE_USER_BODY })],
        [ACTOR_ROW],
      ]);
      const published: Array<{ subject: string; payload: unknown }> = [];
      const messaging: Publisher = {
        publish: (subject, payload) => {
          published.push({ subject, payload });
        },
      };
      const app = appWithDb(database, { messaging });

      const response = await app.handle(
        signedRequest(
          'POST',
          '/internal/users',
          ADMIN_IDENTITY,
          CREATE_USER_BODY,
        ),
      );

      expect(response.status).toBe(200);
      expect(published).toHaveLength(1);
      expect(published[0]?.payload).toMatchObject({
        type: 'user.invited',
        userId: NEW_USER_ID,
        email: CREATE_USER_BODY.email,
        name: CREATE_USER_BODY.name,
        requestedBy: ADMIN_ID,
      });
    } finally {
      teardown();
    }
  });

  it('rolls back the create when the audit write fails, and never publishes an invitation (known gap for /test, AC-7)', async () => {
    writeAuditSpy = spyOn(ActivityLog, 'writeAudit').mockRejectedValue(
      new Error('logs database is unreachable'),
    );
    try {
      const { database } = createFakeDatabase([
        [],
        [dbRow({ ...CREATE_USER_BODY })],
        [ACTOR_ROW],
      ]);
      const published: unknown[] = [];
      const messaging: Publisher = {
        publish: (_subject, payload) => {
          published.push(payload);
        },
      };
      const app = appWithDb(database, { messaging });

      const response = await app.handle(
        signedRequest(
          'POST',
          '/internal/users',
          ADMIN_IDENTITY,
          CREATE_USER_BODY,
        ),
      );

      // The mutation is not returned to the caller as successful: a failed
      // audit write fails the request, matching the log subsystem contract.
      expect(response.status).toBeGreaterThanOrEqual(500);
      // The invitation is published only after the transaction commits, so a
      // rolled back create must never fire it.
      expect(published).toHaveLength(0);
    } finally {
      teardown();
    }
  });

  it('rejects a body missing a required field with a validation error', async () => {
    const { database } = createFakeDatabase([]);
    const app = appWithDb(database);
    const { id: _id, ...withoutId } = CREATE_USER_BODY;

    const response = await app.handle(
      signedRequest('POST', '/internal/users', ADMIN_IDENTITY, withoutId),
    );

    expect(response.status).toBe(422);
  });
});

describe('users update (spec docs/specs/0007-user-management, AC-3, AC-6)', () => {
  let writeAuditSpy: ReturnType<typeof spyOn>;

  const setup = () => {
    writeAuditSpy = spyOn(ActivityLog, 'writeAudit').mockResolvedValue(
      undefined as never,
    );
  };
  const teardown = () => writeAuditSpy.mockRestore();

  it("updates a user's name and audits the change", async () => {
    setup();
    try {
      const { database } = createFakeDatabase([
        [dbRow({ name: 'Old Name' })], // findByIdForUpdate (before)
        [dbRow({ name: 'New Name' })], // updateProfile (after)
        [ACTOR_ROW],
      ]);
      const app = appWithDb(database);

      const response = await app.handle(
        signedRequest('PATCH', `/internal/users/${TARGET_ID}`, ADMIN_IDENTITY, {
          name: 'New Name',
        }),
      );
      const body = (await response.json()) as { name: string };

      expect(response.status).toBe(200);
      expect(body.name).toBe('New Name');
      expect(writeAuditSpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'update', entityId: TARGET_ID }),
      );
    } finally {
      teardown();
    }
  });

  it('ignores an email field even if one is sent, because the schema has no such property', async () => {
    setup();
    try {
      const { database } = createFakeDatabase([
        [dbRow({ email: 'original@project.local' })],
        [dbRow({ email: 'original@project.local', name: 'Renamed' })],
        [ACTOR_ROW],
      ]);
      const app = appWithDb(database);

      const response = await app.handle(
        signedRequest('PATCH', `/internal/users/${TARGET_ID}`, ADMIN_IDENTITY, {
          name: 'Renamed',
          email: 'attacker-supplied@project.local',
        }),
      );
      const body = (await response.json()) as { email: string };

      // additionalProperties is rejected by the schema, or the field is
      // silently dropped; either way the stored email never changes.
      expect([200, 422]).toContain(response.status);
      if (response.status === 200) {
        expect(body.email).toBe('original@project.local');
      }
    } finally {
      teardown();
    }
  });

  it('returns 404 for a user that does not exist', async () => {
    const { database } = createFakeDatabase([[]]);
    const app = appWithDb(database);

    const response = await app.handle(
      signedRequest('PATCH', `/internal/users/${TARGET_ID}`, ADMIN_IDENTITY, {
        name: 'Anyone',
      }),
    );

    expect(response.status).toBe(404);
  });

  it('returns 409 user_deleted when updating a deleted user', async () => {
    const { database } = createFakeDatabase([
      [dbRow({ deleted_at: '2026-08-20 00:00:00.000' })],
    ]);
    const app = appWithDb(database);

    const response = await app.handle(
      signedRequest('PATCH', `/internal/users/${TARGET_ID}`, ADMIN_IDENTITY, {
        name: 'Anyone',
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { reason: 'user_deleted' },
    });
  });
});

describe('users status actions (spec docs/specs/0007-user-management, AC-4, AC-5, AC-6)', () => {
  let writeAuditSpy: ReturnType<typeof spyOn>;

  const setup = () => {
    writeAuditSpy = spyOn(ActivityLog, 'writeAudit').mockResolvedValue(
      undefined as never,
    );
  };
  const teardown = () => writeAuditSpy.mockRestore();

  it('suspends an active user with a reason and audits it', async () => {
    setup();
    try {
      const { database } = createFakeDatabase([
        [dbRow()], // findByIdForUpdate: active
        [dbRow({ suspended_at: '2026-08-22 10:00:00.000' })],
        [ACTOR_ROW],
      ]);
      const app = appWithDb(database);

      const response = await app.handle(
        signedRequest(
          'POST',
          `/internal/users/${TARGET_ID}/suspend`,
          ADMIN_IDENTITY,
          { reason: 'policy violation' },
        ),
      );
      const body = (await response.json()) as { status: string };

      expect(response.status).toBe(200);
      expect(body.status).toBe('suspended');
      expect(writeAuditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'suspend',
          reason: 'policy violation',
        }),
      );
    } finally {
      teardown();
    }
  });

  it('rejects an invalid transition, e.g. unsuspending a user who is active (409)', async () => {
    const { database } = createFakeDatabase([[dbRow()]]);
    const app = appWithDb(database);

    const response = await app.handle(
      signedRequest(
        'POST',
        `/internal/users/${TARGET_ID}/unsuspend`,
        ADMIN_IDENTITY,
        { reason: 'reversing suspension' },
      ),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { reason: 'invalid_transition' },
    });
  });

  it("rejects a status action against the caller's own account (self guard, AC-6)", async () => {
    const { database, queries } = createFakeDatabase([]);
    const app = appWithDb(database);

    const response = await app.handle(
      signedRequest(
        'POST',
        `/internal/users/${ADMIN_ID}/suspend`,
        ADMIN_IDENTITY,
        { reason: 'testing self guard' },
      ),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { reason: 'self_action' },
    });
    // The guard fires before any query, since it does not need the row.
    expect(queries).toHaveLength(0);
  });

  it('rejects any action but restore on an already deleted user (409 user_deleted)', async () => {
    const { database } = createFakeDatabase([
      [dbRow({ deleted_at: '2026-08-20 00:00:00.000' })],
    ]);
    const app = appWithDb(database);

    const response = await app.handle(
      signedRequest(
        'POST',
        `/internal/users/${TARGET_ID}/block`,
        ADMIN_IDENTITY,
        { reason: 'too late' },
      ),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { reason: 'user_deleted' },
    });
  });

  it('requires a reason of at least 3 characters (422)', async () => {
    const { database } = createFakeDatabase([]);
    const app = appWithDb(database);

    const response = await app.handle(
      signedRequest(
        'POST',
        `/internal/users/${TARGET_ID}/suspend`,
        ADMIN_IDENTITY,
        { reason: 'no' },
      ),
    );

    expect(response.status).toBe(422);
  });

  it('soft deletes then restores a previously suspended user back to suspended, not active (AC-5)', async () => {
    setup();
    try {
      const alreadySuspended = dbRow({
        suspended_at: '2026-08-01 00:00:00.000',
      });
      const { database: deleteDb } = createFakeDatabase([
        [alreadySuspended], // findByIdForUpdate: suspended
        [
          dbRow({
            suspended_at: '2026-08-01 00:00:00.000',
            deleted_at: '2026-08-22 00:00:00.000',
          }),
        ],
        [ACTOR_ROW],
      ]);
      const deleteResponse = await appWithDb(deleteDb).handle(
        signedRequest(
          'DELETE',
          `/internal/users/${TARGET_ID}`,
          ADMIN_IDENTITY,
          { reason: 'retiring the account' },
        ),
      );
      const deletedBody = (await deleteResponse.json()) as { status: string };

      expect(deleteResponse.status).toBe(200);
      expect(deletedBody.status).toBe('deleted');

      const { database: restoreDb } = createFakeDatabase([
        [
          dbRow({
            suspended_at: '2026-08-01 00:00:00.000',
            deleted_at: '2026-08-22 00:00:00.000',
          }),
        ],
        [dbRow({ suspended_at: '2026-08-01 00:00:00.000', deleted_at: null })],
        [ACTOR_ROW],
      ]);
      const restoreResponse = await appWithDb(restoreDb).handle(
        signedRequest(
          'POST',
          `/internal/users/${TARGET_ID}/restore`,
          ADMIN_IDENTITY,
          { reason: 'reinstating the account' },
        ),
      );
      const restoredBody = (await restoreResponse.json()) as { status: string };

      expect(restoreResponse.status).toBe(200);
      expect(restoredBody.status).toBe('suspended');
    } finally {
      teardown();
    }
  });
});

describe('users list (spec docs/specs/0007-user-management, AC-9)', () => {
  it('returns pagination meta for a page beyond the first', async () => {
    const { database } = createFakeDatabase([[{ total: 26 }], [dbRow()]]);
    const app = appWithDb(database);

    const response = await app.handle(
      signedRequest('GET', '/internal/users?page=2', ADMIN_IDENTITY),
    );
    const body = (await response.json()) as {
      meta: {
        page: number;
        perPage: number;
        total: number;
        totalPages: number;
      };
    };

    expect(response.status).toBe(200);
    expect(body.meta).toEqual({
      page: 2,
      perPage: 100,
      total: 26,
      totalPages: 1,
    });
  });

  it('defaults an invalid page value to 1', async () => {
    const { database } = createFakeDatabase([[{ total: 0 }], []]);
    const app = appWithDb(database);

    const response = await app.handle(
      signedRequest('GET', '/internal/users?page=abc', ADMIN_IDENTITY),
    );
    const body = (await response.json()) as { meta: { page: number } };

    expect(body.meta.page).toBe(1);
  });
});

describe('UsersRepository (spec docs/specs/0007-user-management)', () => {
  it('binds search input as a parameter, never into SQL text', async () => {
    const injection = "staff' OR 1=1 --";
    const { database, queries } = createFakeDatabase([[{ total: 0 }], []]);
    const repository = new UsersRepository(database);

    await repository.list({
      search: injection,
      status: '',
      page: 1,
      pageSize: 25,
    });

    for (const query of queries) {
      expect(query.text).not.toContain(injection);
    }
    expect(queries[0]?.params[0]).toBe(`%${injection}%`);
  });

  it("escapes % and _ in the ILIKE pattern with ESCAPE '\\'", async () => {
    const { database, queries } = createFakeDatabase([[{ total: 0 }], []]);
    const repository = new UsersRepository(database);

    await repository.list({
      search: '50%_admin',
      status: '',
      page: 1,
      pageSize: 25,
    });

    expect(queries[0]?.params[0]).toBe('%50\\%\\_admin%');
    expect(queries[1]?.text).toContain("ESCAPE '\\'");
  });

  it('maps each status filter to its whitelisted predicate', async () => {
    const cases: Array<[UserStatusFilter, string | null]> = [
      [
        'active',
        'suspended_at IS NULL AND blocked_at IS NULL AND deleted_at IS NULL',
      ],
      ['deleted', 'deleted_at IS NOT NULL'],
      ['all', null],
    ];

    for (const [status, predicate] of cases) {
      const { database, queries } = createFakeDatabase([[{ total: 0 }], []]);
      const repository = new UsersRepository(database);

      await repository.list({ search: '', status, page: 1, pageSize: 25 });

      if (predicate) {
        expect(queries[0]?.text).toContain(predicate);
      } else {
        expect(queries[0]?.text).not.toContain('WHERE');
      }
    }
  });

  it('pages at 25 rows using bound LIMIT and OFFSET', async () => {
    const { database, queries } = createFakeDatabase([[{ total: 60 }], []]);
    const repository = new UsersRepository(database);

    await repository.list({ search: '', status: '', page: 3, pageSize: 25 });

    const listQuery = queries[1];
    expect(listQuery?.text).toContain('LIMIT $1 OFFSET $2');
    expect(listQuery?.params).toEqual([25, 50]);
  });

  it('leaves a column out of the status patch unchanged, so restore returns to the prior status (AC-5)', async () => {
    const state: Record<string, unknown> = {
      suspended_at: '2026-08-01 00:00:00.000',
      blocked_at: null,
      deleted_at: null,
    };
    const database = {
      unsafe(text: string) {
        if (text.includes('deleted_at = now()')) {
          state.deleted_at = '2026-08-22 00:00:00.000';
        }

        if (text.includes('deleted_at = NULL')) {
          state.deleted_at = null;
        }

        return Promise.resolve([dbRow({ ...state })]);
      },
    } as unknown as DatabaseClient;
    const repository = new UsersRepository(database);

    const deleted = await repository.setStatusTimestamps(
      TARGET_ID,
      { deletedAt: 'now' },
      database,
    );
    expect(deleted?.status).toBe('deleted');

    const restored = await repository.setStatusTimestamps(
      TARGET_ID,
      { deletedAt: null },
      database,
    );
    expect(restored?.status).toBe('suspended');
    expect(restored?.suspendedAt).not.toBeNull();
  });
});

describe('UsersService invitation fallback (spec docs/specs/0007-user-management, AC-2)', () => {
  const ACTOR = { id: ADMIN_ID, email: ADMIN_EMAIL };
  const CORRELATION = { requestId: null, ipAddress: null, userAgent: null };

  it('logs user.invited.skipped and still creates the user when no messaging is configured', async () => {
    const writeAuditSpy = spyOn(ActivityLog, 'writeAudit').mockResolvedValue(
      undefined as never,
    );
    try {
      const { database } = createFakeDatabase([
        [],
        [dbRow({ ...CREATE_USER_BODY })],
        [ACTOR_ROW],
      ]);
      const logger = new Logger('user-test', 'debug');
      const warnSpy = spyOn(logger, 'warn');
      const service = new UsersService('user', { database, logger });

      const created = await service.create(
        CREATE_USER_BODY,
        ACTOR,
        CORRELATION,
      );

      expect(created.id).toBe(NEW_USER_ID);
      expect(warnSpy).toHaveBeenCalledWith('user.invited.skipped', {
        userId: NEW_USER_ID,
        reason: 'messaging is not configured',
      });
    } finally {
      writeAuditSpy.mockRestore();
    }
  });

  it('enqueues the invitation inside the create transaction when durable jobs are enabled', async () => {
    const writeAuditSpy = spyOn(ActivityLog, 'writeAudit').mockResolvedValue(
      undefined as never,
    );
    try {
      const { database, enqueueQueries } = createDurableFakeDatabase([
        [],
        [dbRow({ ...CREATE_USER_BODY })],
        [ACTOR_ROW],
      ]);
      const jobs = new JobRegistry();
      jobs.registerContract(authSendUserInvitationContract);
      const service = new UsersService('user', {
        database,
        jobs,
        durableJobsEnabled: true,
      });

      const created = await service.create(
        CREATE_USER_BODY,
        ACTOR,
        CORRELATION,
      );

      expect(created.id).toBe(NEW_USER_ID);
      expect(enqueueQueries[0]).toContain('jobs.enqueue_job');
      expect(enqueueQueries[0]).toContain('user-invitation:');
    } finally {
      writeAuditSpy.mockRestore();
    }
  });

  it('AC-6 enqueues recipient projection synchronization with the invitation', async () => {
    const writeAuditSpy = spyOn(ActivityLog, 'writeAudit').mockResolvedValue(
      undefined as never,
    );
    try {
      const { database, enqueueQueries } = createDurableFakeDatabase([
        [],
        [dbRow({ ...CREATE_USER_BODY })],
        [ACTOR_ROW],
      ]);
      const jobs = new JobRegistry();
      jobs.registerContract(authSendUserInvitationContract);
      jobs.registerContract(notificationRecipientSyncContract);
      const service = new UsersService('user', {
        database,
        jobs,
        durableJobsEnabled: true,
      });

      await service.create(CREATE_USER_BODY, ACTOR, CORRELATION);

      expect(enqueueQueries).toHaveLength(2);
      expect(
        enqueueQueries.every((query) => query.includes('jobs.enqueue_job')),
      ).toBe(true);
    } finally {
      writeAuditSpy.mockRestore();
    }
  });

  it('logs user.invited.publish_failed and still returns the created user when publish throws', async () => {
    const writeAuditSpy = spyOn(ActivityLog, 'writeAudit').mockResolvedValue(
      undefined as never,
    );
    try {
      const { database } = createFakeDatabase([
        [],
        [dbRow({ ...CREATE_USER_BODY })],
        [ACTOR_ROW],
      ]);
      const logger = new Logger('user-test', 'debug');
      const warnSpy = spyOn(logger, 'warn');
      const messaging: Publisher = {
        publish: () => {
          throw new Error('nats connection dropped');
        },
      };
      const service = new UsersService('user', { database, logger, messaging });

      const created = await service.create(
        CREATE_USER_BODY,
        ACTOR,
        CORRELATION,
      );

      expect(created.id).toBe(NEW_USER_ID);
      expect(warnSpy).toHaveBeenCalledWith(
        'user.invited.publish_failed',
        expect.objectContaining({ userId: NEW_USER_ID }),
      );
    } finally {
      writeAuditSpy.mockRestore();
    }
  });
});
