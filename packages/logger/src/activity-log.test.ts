import { afterEach, describe, expect, it } from 'bun:test';
import type { DatabaseClient } from '#project/database';
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

afterEach(() => {
  ActivityLog.configure(undefined);
});

describe('ActivityLog.writeAudit', () => {
  it('awaits the insert and returns the record', async () => {
    const { database, queries } = createFakeDatabase();
    ActivityLog.configure(database);

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
    ActivityLog.configure(database);

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
    ActivityLog.configure(database);

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
