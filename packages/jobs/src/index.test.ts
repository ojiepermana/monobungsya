import { describe, expect, test } from 'bun:test';
import type { DatabaseClient } from '#project/database';
import {
  assertSafePayload,
  DurableJobRuntime,
  JobRegistry,
  retryDelayMs,
} from './index';

function createFakeDatabase() {
  const queries: string[] = [];
  const fake = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push(
      strings.raw
        .map((part, index) => `${part}${values[index] ?? ''}`)
        .join(''),
    );
    return [{ id: 'job-1', status: 'queued' }];
  }) as unknown as DatabaseClient;
  return { database: fake, queries };
}

describe('durable job runtime primitives', () => {
  test('rejects secret shaped payload fields and oversized payloads', () => {
    expect(() => assertSafePayload({ access_token: 'secret' })).toThrow(
      'sensitive field',
    );
    expect(() => assertSafePayload({ body: 'x'.repeat(65 * 1024) })).toThrow(
      'exceeds',
    );
  });

  test('validates registered payloads and returns an allowlisted operator view', () => {
    const registry = new JobRegistry();
    registry.register({
      type: 'auth.cleanup',
      version: 1,
      sourceService: 'auth',
      targetService: 'auth',
      validate: (payload): payload is { userId: string } =>
        typeof payload === 'object' &&
        payload !== null &&
        typeof (payload as { userId?: unknown }).userId === 'string',
      operatorPayloadKeys: ['userId'],
    });

    registry.assertPayload('auth.cleanup', 1, { userId: 'user-1' });
    expect(
      registry.operatorPayload('auth.cleanup', 1, {
        userId: 'user-1',
        ignored: true,
      }),
    ).toEqual({ userId: 'user-1' });
    expect(() => registry.assertPayload('auth.unknown', 1, {})).toThrow(
      'unknown job type',
    );
  });

  test('calculates bounded exponential retry delay with jitter', () => {
    expect(retryDelayMs(1, 0)).toBe(5_000);
    expect(retryDelayMs(2, 1)).toBe(12_000);
    expect(retryDelayMs(99, 1)).toBe(18 * 60_000);
  });

  test('enqueues through the database function after registry validation', async () => {
    const { database, queries } = createFakeDatabase();
    const registry = new JobRegistry();
    registry.register({
      type: 'auth.cleanup',
      version: 1,
      sourceService: 'auth',
      targetService: 'auth',
      validate: (payload): payload is { userId: string } =>
        typeof payload === 'object' &&
        payload !== null &&
        typeof (payload as { userId?: unknown }).userId === 'string',
      operatorPayloadKeys: ['userId'],
    });
    const runtime = new DurableJobRuntime(database, registry);

    await runtime.enqueue({
      type: 'auth.cleanup',
      version: 1,
      payload: { userId: 'user-1' },
      sourceService: 'auth',
      targetService: 'auth',
      idempotencyKey: 'cleanup:user-1',
    });

    expect(queries[0]).toContain('jobs.enqueue_job');
    expect(queries[0]).toContain('cleanup:user-1');
  });
});
