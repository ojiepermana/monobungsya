import { describe, expect, it } from 'bun:test';
import {
  createTelemetryDatabaseClient,
  type DatabaseClient,
  withTransaction,
} from './index';

interface FakeDatabase {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  unsafe(sql: string, values?: unknown[]): Promise<unknown[]>;
  array(values: unknown[], type: string): { values: unknown[]; type: string };
  begin<T>(operation: (transaction: FakeDatabase) => Promise<T>): Promise<T>;
}

function fakeDatabase(): FakeDatabase {
  const database = (async () => []) as unknown as FakeDatabase;
  database.unsafe = async () => [];
  database.array = (values, type) => ({ values, type });
  database.begin = async (operation) => operation(database);
  return database;
}

describe('telemetry database boundary', () => {
  it('wraps tagged queries, unsafe queries, and transaction queries', async () => {
    const spans: string[] = [];
    const telemetry = {
      withSpan<T>(definition: { operation: string }, action: () => T): T {
        spans.push(definition.operation);
        return action();
      },
    };
    const database = createTelemetryDatabaseClient(
      fakeDatabase() as unknown as DatabaseClient,
      telemetry,
      'user.database',
    );

    await database`SELECT 1`;
    await database.unsafe('SELECT 1', []);
    await withTransaction(database, async (transaction) => {
      await transaction.unsafe('SELECT 1', []);
    });

    expect(spans).toEqual(['query', 'query', 'transaction', 'query']);
  });
});
