import { describe, expect, it } from 'bun:test';
import { loadEnv } from '#project/config';
import { signAuthIdentity } from '#project/contracts';
import type { DatabaseClient } from '#project/database';
import { createApp } from '../app';
import { LogsRepository } from '../modules/logs/logs.repository';
import { LogsService } from '../modules/logs/logs.service';

interface RecordedQuery {
  text: string;
  params: unknown[];
}

function createFakeDatabase(respond: (query: RecordedQuery) => unknown[]): {
  database: DatabaseClient;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const fake = {
    unsafe(text: string, params: unknown[] = []) {
      const query = { text, params };
      queries.push(query);
      return Promise.resolve(respond(query));
    },
  };

  return { database: fake as unknown as DatabaseClient, queries };
}

const AUDIT_ROW = {
  id: '0198f8a0-0000-7000-8000-00000000aaaa',
  action: 'update',
  module: 'users',
  entity_type: 'user',
  entity_id: 'user-1',
  entity_label: 'Jane Staff',
  actor_email: 'admin@project.local',
  actor_role: 'admin',
  change_summary: 'role changed',
  audited_at: '2026-08-22 09:15:30.123',
};

describe('logs service app', () => {
  const testEnv = (extra: Record<string, string> = {}) =>
    loadEnv('logs', { NODE_ENV: 'test', PORT: '3103', ...extra });

  it('exposes the health endpoint', async () => {
    const app = createApp(testEnv());
    const health = await app.handle(new Request('http://localhost/health'));

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', service: 'logs' });
  });

  it('serves an empty page without infrastructure', async () => {
    const app = createApp(testEnv());
    const response = await app.handle(
      new Request('http://localhost/internal/logs/audit-trails'),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [],
      meta: { page: 1, perPage: 25, total: 0, totalPages: 0 },
      filters: { search: '', module: '', action: '' },
      options: { modules: [], actions: [] },
    });
  });

  it('requires a signed identity and denies roles without logs.read', async () => {
    const secret = 'logs-service-signing-secret';
    const app = createApp(testEnv({ INTERNAL_AUTH_SIGNING_SECRET: secret }));
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const request = (role: 'admin' | 'manager' | 'staff') => {
      const identity = {
        userId: '0198f8a0-0000-7000-8000-000000000001',
        email: 'operator@project.local',
        role,
        expiresAt,
      };
      const signature = signAuthIdentity(
        'GET',
        '/internal/logs/access-logs',
        identity,
        secret,
      );

      return new Request('http://localhost/internal/logs/access-logs', {
        headers: {
          'x-auth-user-id': identity.userId,
          'x-auth-email': identity.email,
          'x-auth-role': identity.role,
          'x-auth-expires-at': identity.expiresAt,
          'x-auth-signature': signature,
        },
      });
    };

    const unsigned = await app.handle(
      new Request('http://localhost/internal/logs/access-logs'),
    );
    expect(unsigned.status).toBe(401);

    const staff = await app.handle(request('staff'));
    expect(staff.status).toBe(403);

    const admin = await app.handle(request('admin'));
    expect(admin.status).toBe(200);

    const manager = await app.handle(request('manager'));
    expect(manager.status).toBe(200);
  });
});

describe('logs repository', () => {
  it('binds search input as a parameter, never into SQL text', async () => {
    const injection = "login' OR 1=1 --";
    const { database, queries } = createFakeDatabase((query) =>
      query.text.startsWith('SELECT count') ? [{ total: 0 }] : [],
    );
    const repository = new LogsRepository(database);

    await repository.listAuditTrails({
      search: injection,
      module: '',
      action: '',
      page: 1,
    });

    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(query.text).not.toContain(injection);
      expect(query.text).not.toContain('OR 1=1');
    }
    expect(queries[0]?.params[0]).toBe(`%${injection}%`);
  });

  it("escapes % and _ in the ILIKE pattern with ESCAPE '\\'", async () => {
    const { database, queries } = createFakeDatabase((query) =>
      query.text.startsWith('SELECT count') ? [{ total: 0 }] : [],
    );
    const repository = new LogsRepository(database);

    await repository.listAccessLogs({
      search: '50%_done',
      event: '',
      outcome: '',
      page: 1,
    });

    expect(queries[0]?.params[0]).toBe('%50\\%\\_done%');
    expect(queries[0]?.text).toContain("ESCAPE '\\'");
  });

  it('orders newest first and pages at 25 rows', async () => {
    const { database, queries } = createFakeDatabase((query) =>
      query.text.startsWith('SELECT count') ? [{ total: 26 }] : [],
    );
    const repository = new LogsRepository(database);

    await repository.listAuditTrails({
      search: '',
      module: 'users',
      action: '',
      page: 2,
    });

    const listQuery = queries[1];
    expect(listQuery?.text).toContain('ORDER BY audited_at DESC, id DESC');
    expect(listQuery?.params).toEqual(['users', 25, 25]);
  });

  it('maps snake_case columns to camelCase and parses jsonb strings', async () => {
    const { database } = createFakeDatabase((query) => {
      if (query.text.startsWith('SELECT count')) return [{ total: 1 }];
      return [
        {
          id: 'log-1',
          level: 'error',
          channel: null,
          category: 'application',
          event: 'invoice.failed',
          module: 'billing',
          message: 'boom',
          context: '{"invoiceId":42}',
          exception_class: 'DatabaseError',
          exception_message: 'connection refused',
          stack_trace: 'at main.ts:1',
          actor_user_id: 'user-1',
          actor_name: 'Jane',
          actor_email: 'jane@project.local',
          occurred_at: '2026-08-22 09:15:30.123',
          created_at: '2026-08-22 09:15:30.123',
        },
      ];
    });
    const repository = new LogsRepository(database);

    const { items } = await repository.listApplicationLogs({
      search: '',
      level: '',
      module: '',
      event: '',
      page: 1,
    });

    expect(items[0]).toEqual({
      id: 'log-1',
      level: 'error',
      channel: 'application',
      category: 'application',
      event: 'invoice.failed',
      module: 'billing',
      message: 'boom',
      context: { invoiceId: 42 },
      exceptionClass: 'DatabaseError',
      exceptionMessage: 'connection refused',
      stackTrace: 'at main.ts:1',
      actorUserId: 'user-1',
      actorName: 'Jane',
      actorEmail: 'jane@project.local',
      occurredAt: '2026-08-22T09:15:30.123Z',
      createdAt: '2026-08-22T09:15:30.123Z',
    });
  });

  it('reads distinct dropdown options per filter column', async () => {
    const { database, queries } = createFakeDatabase((query) => {
      if (query.text.includes('DISTINCT module')) {
        return [{ value: 'billing' }, { value: 'users' }];
      }
      if (query.text.includes('DISTINCT action')) {
        return [{ value: 'create' }, { value: 'update' }];
      }
      return [];
    });
    const repository = new LogsRepository(database);

    const options = await repository.auditTrailOptions();

    expect(options).toEqual({
      modules: ['billing', 'users'],
      actions: ['create', 'update'],
    });
    for (const query of queries) {
      expect(query.text).toContain('SELECT DISTINCT');
      expect(query.text).toContain('IS NOT NULL');
    }
  });
});

describe('logs service pagination and filters', () => {
  function repositoryWithTotal(total: number) {
    const { database } = createFakeDatabase((query) =>
      query.text.startsWith('SELECT count')
        ? [{ total }]
        : query.text.includes('DISTINCT')
          ? []
          : [],
    );
    return new LogsRepository(database);
  }

  it('returns meta { page: 2, perPage: 25, total: 26, totalPages: 2 } for 26 rows', async () => {
    const service = new LogsService(repositoryWithTotal(26));

    const result = await service.getAuditTrails({ page: '2' });

    expect(result.meta).toEqual({
      page: 2,
      perPage: 25,
      total: 26,
      totalPages: 2,
    });
  });

  it('defaults invalid page values to 1', async () => {
    const service = new LogsService(repositoryWithTotal(0));

    for (const page of ['0', '-3', 'abc', undefined]) {
      const result = await service.getAccessLogs({ page });
      expect(result.meta.page).toBe(1);
    }
  });

  it('squishes and trims filter values', async () => {
    const service = new LogsService(repositoryWithTotal(0));

    const result = await service.getApplicationLogs({
      search: '  failed   invoice  ',
      level: ' error ',
    });

    expect(result.filters.search).toBe('failed invoice');
    expect(result.filters.level).toBe('error');
  });

  it('maps audit rows through the repository into the response shape', async () => {
    const { database } = createFakeDatabase((query) => {
      if (query.text.startsWith('SELECT count')) return [{ total: 1 }];
      if (query.text.includes('DISTINCT')) return [];
      return [AUDIT_ROW];
    });
    const service = new LogsService(new LogsRepository(database));

    const result = await service.getAuditTrails({});

    expect(result.data[0]).toEqual({
      id: AUDIT_ROW.id,
      action: 'update',
      module: 'users',
      entityType: 'user',
      entityId: 'user-1',
      entityLabel: 'Jane Staff',
      actorEmail: 'admin@project.local',
      actorRole: 'admin',
      changeSummary: 'role changed',
      auditedAt: '2026-08-22T09:15:30.123Z',
    });
  });
});
