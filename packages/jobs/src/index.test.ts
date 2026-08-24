import { describe, expect, test } from 'bun:test';
import type { DatabaseClient } from '#project/database';
import {
  assertSafePayload,
  DurableJobRuntime,
  DurableJobWorker,
  type JobRecord,
  JobRegistry,
  retryDelayMs,
  toJobFailure,
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
      validate: (payload: unknown): payload is { userId: string } =>
        typeof payload === 'object' &&
        payload !== null &&
        typeof (payload as { userId?: unknown }).userId === 'string',
      handler: async () => {},
      domainIdempotencyKey: (payload) => payload.userId,
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
      validate: (payload: unknown): payload is { userId: string } =>
        typeof payload === 'object' &&
        payload !== null &&
        typeof (payload as { userId?: unknown }).userId === 'string',
      handler: async () => {},
      domainIdempotencyKey: (payload) => payload.userId,
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

  test('separates shared contracts from target service handler bindings', async () => {
    const contract = {
      type: 'auth.cleanup_expired_security_data',
      version: 1,
      sourceService: 'jobs',
      targetService: 'auth',
      validate: (payload: unknown): payload is { userId: string } =>
        typeof payload === 'object' &&
        payload !== null &&
        typeof (payload as { userId?: unknown }).userId === 'string',
      domainIdempotencyKey: (payload: { userId: string }) => payload.userId,
      operatorPayloadKeys: ['userId'],
      schedules: [
        {
          code: 'auth.cleanup_expired_security_data',
          cronExpression: '0 3 * * *',
          timezone: 'Asia/Jakarta',
        },
      ],
    };
    const registry = new JobRegistry();

    registry.registerContract(contract);

    expect(registry.getBoundDefinition(contract.type, contract.version)).toBe(
      undefined,
    );
    expect(registry.getScheduledContracts()).toHaveLength(1);
    expect(() => registry.assertReadyForTarget('auth')).toThrow(
      'missing job handlers',
    );

    registry.bind(contract, async () => undefined);

    expect(() => registry.assertReadyForTarget('auth')).not.toThrow();
    expect(
      registry.getBoundDefinition(contract.type, contract.version)?.handler,
    ).toBeFunction();
  });

  test('rejects schedule metadata owned by a non jobs source service', () => {
    const registry = new JobRegistry();

    expect(() =>
      registry.registerContract({
        type: 'auth.cleanup_expired_security_data',
        version: 1,
        sourceService: 'auth',
        targetService: 'auth',
        validate: (payload: unknown): payload is Record<string, never> =>
          typeof payload === 'object' && payload !== null,
        domainIdempotencyKey: () => 'cleanup',
        operatorPayloadKeys: [],
        schedules: [
          {
            code: 'auth.cleanup_expired_security_data',
            cronExpression: '0 3 * * *',
            timezone: 'Asia/Jakarta',
          },
        ],
      }),
    ).toThrow('source service jobs');
  });

  test('rejects a target handler binding when metadata differs', () => {
    const registry = new JobRegistry();
    const contract = {
      type: 'auth.cleanup',
      version: 1,
      sourceService: 'auth',
      targetService: 'auth',
      validate: (payload: unknown): payload is { userId: string } =>
        typeof payload === 'object' &&
        payload !== null &&
        typeof (payload as { userId?: unknown }).userId === 'string',
      domainIdempotencyKey: (payload: { userId: string }) => payload.userId,
      operatorPayloadKeys: ['userId'],
    };

    registry.registerContract(contract);

    expect(() =>
      registry.bind(
        { ...contract, targetService: 'user' },
        async () => undefined,
      ),
    ).toThrow('metadata mismatch');
  });
});

function jobRecord(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: '0198f8a0-0000-7000-8000-000000000001',
    type: 'auth.cleanup',
    version: 1,
    payload: { userId: 'user-1' },
    source_service: 'auth',
    target_service: 'auth',
    idempotency_key: 'cleanup:user-1',
    correlation_id: null,
    actor_user_id: null,
    status: 'running',
    priority: 0,
    run_at: '2026-08-24 00:00:00',
    attempt_count: 1,
    max_attempts: 5,
    locked_by: 'worker-1',
    locked_at: '2026-08-24 00:00:00',
    lease_expires_at: '2026-08-24 00:01:00',
    completed_at: null,
    failed_at: null,
    last_error_code: null,
    last_error_message: null,
    schedule_code: null,
    retry_of_job_id: null,
    created_at: '2026-08-24 00:00:00',
    updated_at: '2026-08-24 00:00:00',
    ...overrides,
  };
}

function createWorkerRuntime(job: JobRecord) {
  const events: string[] = [];
  const runtime = {
    claim: async () => {
      if (events.includes('claimed')) return [];
      events.push('claimed');
      return [job];
    },
    heartbeat: async () => true,
    complete: async () => {
      events.push('completed');
      return true;
    },
    fail: async (
      _job: JobRecord,
      _workerId: string,
      failure: { code: string },
    ) => {
      events.push(`failed:${failure.code}`);
      return true;
    },
    release: async () => {
      events.push('released');
      return true;
    },
  };
  return { events, runtime };
}

function createWorkerRegistry(handler: (signal: AbortSignal) => Promise<void>) {
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
    handler: async (_payload, context) => handler(context.signal),
    domainIdempotencyKey: (payload) => payload.userId,
    operatorPayloadKeys: ['userId'],
  });
  return registry;
}

describe('durable job worker lifecycle', () => {
  test('requires every target contract to have a local handler at startup', () => {
    const registry = new JobRegistry();
    registry.registerContract({
      type: 'auth.cleanup',
      version: 1,
      sourceService: 'auth',
      targetService: 'auth',
      validate: (payload): payload is { userId: string } =>
        typeof payload === 'object' &&
        payload !== null &&
        typeof (payload as { userId?: unknown }).userId === 'string',
      domainIdempotencyKey: (payload: { userId: string }) => payload.userId,
      operatorPayloadKeys: ['userId'],
    });

    expect(
      () =>
        new DurableJobWorker(
          createWorkerRuntime(jobRecord()).runtime,
          registry,
          { workerId: 'worker-1', targetService: 'auth' },
        ),
    ).toThrow('missing job handlers');
  });

  test('processes a claimed job and completes it', async () => {
    const job = jobRecord();
    const { events, runtime } = createWorkerRuntime(job);
    const worker = new DurableJobWorker(
      runtime,
      createWorkerRegistry(async () => undefined),
      {
        workerId: 'worker-1',
        targetService: 'auth',
        pollIntervalMs: 100,
        heartbeatMs: 100,
      },
    );

    expect(await worker.runOnce()).toBe(1);
    await worker.stop();

    expect(events).toEqual(['claimed', 'completed']);
  });

  test('fails a job with a safe error message when the handler throws', async () => {
    const job = jobRecord();
    const { events, runtime } = createWorkerRuntime(job);
    const worker = new DurableJobWorker(
      runtime,
      createWorkerRegistry(async () => {
        throw new Error('provider token secret leaked');
      }),
      { workerId: 'worker-1', targetService: 'auth' },
    );

    await worker.runOnce();
    await worker.stop();

    expect(events).toEqual(['claimed', 'failed:handler_error']);
    expect(toJobFailure(new Error('provider token secret leaked'))).toEqual({
      code: 'handler_error',
      message: 'job handler failed',
      retryable: true,
    });
  });

  test('releases active jobs after the shutdown timeout', async () => {
    const job = jobRecord();
    const { events, runtime } = createWorkerRuntime(job);
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const worker = new DurableJobWorker(
      runtime,
      createWorkerRegistry(async () => blocked),
      {
        workerId: 'worker-1',
        targetService: 'auth',
        shutdownTimeoutMs: 5,
      },
    );

    await worker.runOnce();
    await worker.stop();
    unblock();

    expect(events).toContain('released');
    expect(events).not.toContain('completed');
  });

  test('does not create an unhandled rejection when completion persistence fails', async () => {
    const job = jobRecord();
    const events: string[] = [];
    const runtime = {
      claim: async () => [job],
      heartbeat: async () => true,
      complete: async () => {
        throw new Error('database unavailable');
      },
      fail: async () => true,
      release: async () => true,
    };
    const worker = new DurableJobWorker(
      runtime,
      createWorkerRegistry(async () => undefined),
      {
        workerId: 'worker-1',
        targetService: 'auth',
        onEvent: (event) => events.push(event.name),
      },
    );

    await worker.runOnce();
    await worker.stop();

    expect(events).toContain('job.worker_error');
  });
});
