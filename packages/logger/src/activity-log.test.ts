import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import type { DatabaseClient } from '#project/database';
import { createPostgresObservabilitySignalStore } from '#project/observability';
import { ActivityLog } from './activity-log';

interface RecordedQuery {
  text: string;
  values: unknown[];
}

function createFakeDatabase(
  onQuery?: (query: RecordedQuery) => Promise<unknown> | unknown,
) {
  const queries: RecordedQuery[] = [];

  const record = (query: RecordedQuery) => {
    queries.push(query);
    return Promise.resolve(onQuery ? onQuery(query) : []);
  };

  const fake = (strings: TemplateStringsArray, ...values: unknown[]) =>
    record({ text: strings.join('?'), values });
  fake.unsafe = (text: string) => record({ text, values: [] });
  fake.begin = async (operation: (transaction: unknown) => Promise<unknown>) =>
    operation(fake);

  return { database: fake as unknown as DatabaseClient, queries };
}

function configure(database: DatabaseClient | undefined): void {
  ActivityLog.configure(database, {
    signalStore: database
      ? createPostgresObservabilitySignalStore({ logsDatabase: database })
      : undefined,
  });
}

afterEach(async () => {
  await ActivityLog.flush();
  ActivityLog.configure(undefined);
});

describe('ActivityLog.writeLog', () => {
  it('returns the record synchronously and inserts asynchronously', async () => {
    const { database, queries } = createFakeDatabase();
    configure(database);

    const record = ActivityLog.writeLog({
      level: 'info',
      message: 'invoice posted',
      module: 'billing',
      context: { invoiceId: 42 },
    });

    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.channel).toBe('application');
    expect(record.category).toBe('application');
    expect(record.occurredAt.endsWith('Z')).toBe(true);
    expect(queries).toHaveLength(0);

    await ActivityLog.flush();

    expect(queries).toHaveLength(1);
    expect(queries[0]?.text).toContain('INSERT INTO "logs"."logging"');
    expect(queries[0]?.values).toContain('{"invoiceId":42}');
  });

  it('encodes a missing context as SQL NULL', async () => {
    const { database, queries } = createFakeDatabase();
    configure(database);

    ActivityLog.writeLog({ level: 'info', message: 'no context' });
    await ActivityLog.flush();

    expect(queries[0]?.values[7]).toBeNull();
  });

  it('never fails the caller when the insert fails, and logs the error', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const { database } = createFakeDatabase(() => {
      throw new Error('connection refused');
    });
    configure(database);

    const record = ActivityLog.writeLog({ level: 'error', message: 'boom' });

    expect(record.message).toBe('boom');
    await ActivityLog.flush();

    expect(consoleError).toHaveBeenCalled();
    expect(String(consoleError.mock.calls[0]?.[0])).toContain(
      '[observability] signal delivery failed',
    );
    consoleError.mockRestore();
  });

  it('keeps the queue alive after a failed write', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    let failNext = true;
    const { database, queries } = createFakeDatabase(() => {
      if (failNext) {
        failNext = false;
        throw new Error('transient failure');
      }
      return [];
    });
    configure(database);

    ActivityLog.writeLog({ level: 'error', message: 'first fails' });
    ActivityLog.writeLog({ level: 'info', message: 'second lands' });
    await ActivityLog.flush();

    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries.some((query) => query.values.includes('second lands'))).toBe(
      true,
    );
    consoleError.mockRestore();
  });

  it('skips the insert when no database is configured', async () => {
    ActivityLog.configure(undefined);

    const record = ActivityLog.writeLog({ level: 'info', message: 'offline' });

    expect(record.level).toBe('info');
    await ActivityLog.flush();
  });
});

describe('ActivityLog.writeAccess', () => {
  it('queues the insert with the success outcome default', async () => {
    const { database, queries } = createFakeDatabase();
    configure(database);

    const record = ActivityLog.writeAccess({ event: 'sign_in' });

    expect(record.outcome).toBe('success');
    await ActivityLog.flush();

    expect(queries[0]?.text).toContain('INSERT INTO "logs"."access_logs"');
    expect(queries[0]?.values).toContain('sign_in');
  });
});

describe('ActivityLog.writeAudit', () => {
  it('awaits the insert and returns the record', async () => {
    const { database, queries } = createFakeDatabase();
    configure(database);

    const record = await ActivityLog.writeAudit({
      action: 'update',
      module: 'users',
      entityType: 'user',
      entityId: 'user-1',
      beforeState: { name: 'Staff' },
      afterState: { name: 'Manager' },
    });

    expect(record.action).toBe('update');
    expect(queries).toHaveLength(1);
    expect(queries[0]?.text).toContain('INSERT INTO "logs"."audit_trails"');
    expect(queries[0]?.values).toContain('{"name":"Staff"}');
    expect(queries[0]?.values).toContain('IDR');
  });

  it('propagates insert failures to the caller', async () => {
    const { database } = createFakeDatabase(() => {
      throw new Error('audit insert failed');
    });
    configure(database);

    await expect(
      ActivityLog.writeAudit({
        action: 'delete',
        module: 'users',
        entityType: 'user',
        entityId: 'user-1',
      }),
    ).rejects.toThrow('audit insert failed');
  });

  it('recovers once from a missing partition', async () => {
    let failed = false;
    const { database, queries } = createFakeDatabase((query) => {
      if (query.text.includes('INSERT') && !failed) {
        failed = true;
        throw Object.assign(
          new Error('no partition of relation "audit_trails" found for row'),
          { code: '23514' },
        );
      }
      return [];
    });
    configure(database);

    const record = await ActivityLog.writeAudit({
      action: 'create',
      module: 'billing',
      entityType: 'invoice',
      entityId: 'inv-1',
    });

    expect(record.entityId).toBe('inv-1');
    expect(
      queries.some((query) =>
        query.text.includes('CREATE TABLE IF NOT EXISTS "partition"'),
      ),
    ).toBe(true);
    expect(
      queries.filter((query) => query.text.includes('INSERT')),
    ).toHaveLength(2);
  });

  it('throws when no database is configured', async () => {
    ActivityLog.configure(undefined);

    await expect(
      ActivityLog.writeAudit({
        action: 'create',
        module: 'billing',
        entityType: 'invoice',
        entityId: 'inv-1',
      }),
    ).rejects.toThrow('not configured');
  });
});
