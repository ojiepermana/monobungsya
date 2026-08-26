import { describe, expect, test } from 'bun:test';
import {
  createPostgresObservabilitySignalStore,
  FakeObservabilitySignalStore,
} from '#project/observability';
import {
  formatTraceparent,
  isValidTraceparent,
  TelemetryRuntime,
} from './index';

function fakeDatabase(): {
  calls: string[];
  arrays: Array<{ values: unknown[]; type: string }>;
  database: never;
} {
  const calls: string[] = [];
  const arrays: Array<{ values: unknown[]; type: string }> = [];
  const transaction = {
    unsafe: async (sql: string) => {
      calls.push(sql);
      return [];
    },
    array(values: unknown[], type: string) {
      arrays.push({ values, type });
      return { serializedValues: '', arrayType: type };
    },
  };
  const database = {
    begin: async <T>(operation: (value: typeof transaction) => Promise<T>) =>
      operation(transaction),
  };
  return { calls, arrays, database: database as never };
}

function flakyDatabase(failures: number): {
  attempts: number;
  database: never;
} {
  let attempts = 0;
  const transaction = {
    unsafe: async () => [],
    array(values: unknown[], type: string) {
      return { serializedValues: JSON.stringify(values), arrayType: type };
    },
  };
  const database = {
    begin: async <T>(operation: (value: typeof transaction) => Promise<T>) => {
      attempts += 1;
      if (attempts <= failures) throw new Error('transient telemetry outage');
      return operation(transaction);
    },
  };
  return {
    get attempts() {
      return attempts;
    },
    database: database as never,
  };
}

function poisonMetricDatabase(): {
  attempts: number;
  database: never;
} {
  let attempts = 0;
  const transaction = {
    unsafe: async (sql: string) => {
      if (sql.includes('metric_buckets')) throw new Error('poison metric');
      return [];
    },
    array(values: unknown[], type: string) {
      return { serializedValues: JSON.stringify(values), arrayType: type };
    },
  };
  const database = {
    begin: async <T>(operation: (value: typeof transaction) => Promise<T>) => {
      attempts += 1;
      return operation(transaction);
    },
  };
  return {
    get attempts() {
      return attempts;
    },
    database: database as never,
  };
}

describe('telemetry runtime', () => {
  test('validates and formats W3C traceparent values', () => {
    expect(
      isValidTraceparent(
        '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
      ),
    ).toBe(true);
    expect(isValidTraceparent('00-invalid-0123456789abcdef-01')).toBe(false);
    const runtime = new TelemetryRuntime({
      serviceName: 'test',
      serviceInstanceId: 'test-1',
    });
    const context = runtime.extract({
      traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
    });
    expect(formatTraceparent(context)).toBe(
      `00-${context.traceId}-${context.spanId}-01`,
    );
  });

  test('creates child spans and preserves action results', async () => {
    const { calls, arrays, database } = fakeDatabase();
    const runtime = new TelemetryRuntime({
      serviceName: 'test',
      serviceInstanceId: 'test-1',
      signalStore: createPostgresObservabilitySignalStore({
        telemetryDatabase: database,
      }),
    });
    const parent = runtime.startSpan({
      resourceKind: 'business.operation',
      resourceName: 'test.parent',
      operation: 'run',
      forceSample: true,
    });
    const result = await runtime.withSpan(
      {
        resourceKind: 'db.query',
        resourceName: 'users.list',
        operation: 'select',
        attributes: {
          safe_attribute: 'ok',
          email: 'must not persist',
          payload: 'must not persist',
        },
      },
      async () => 'ok',
    );
    parent.end({ status: 'ok' });
    expect(result).toBe('ok');
    const flush = await runtime.flush();
    expect(flush.failed).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('telemetry');
    expect(calls[0]).not.toContain('must not persist');
    expect(arrays).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'float8' }),
        expect.objectContaining({ type: 'int8' }),
      ]),
    );
    await runtime.shutdown();
  });

  test('keeps an error span even when the trace is not sampled', async () => {
    const { calls, database } = fakeDatabase();
    const runtime = new TelemetryRuntime({
      serviceName: 'test',
      serviceInstanceId: 'test-1',
      signalStore: createPostgresObservabilitySignalStore({
        telemetryDatabase: database,
      }),
      successSampleRate: 0,
    });
    await expect(
      runtime.withSpan(
        {
          resourceKind: 'http.client',
          resourceName: 'service.health',
          operation: 'GET',
        },
        async () => {
          throw new Error('secret details stay out of telemetry');
        },
      ),
    ).rejects.toThrow('secret details stay out of telemetry');
    const flush = await runtime.flush();
    expect(flush.writtenSpans).toBe(1);
    expect(calls[0]).toContain('telemetry');
    expect(calls[0]).not.toContain('secret details');
    await runtime.shutdown();
  });

  test('retries transient flush failures without changing the caller result', async () => {
    const flaky = flakyDatabase(2);
    const runtime = new TelemetryRuntime({
      serviceName: 'test',
      serviceInstanceId: 'test-1',
      signalStore: createPostgresObservabilitySignalStore({
        telemetryDatabase: flaky.database,
      }),
    });
    runtime.withSpan(
      {
        resourceKind: 'business.operation',
        resourceName: 'test.retry',
        operation: 'run',
        forceSample: true,
      },
      () => 'ok',
    );
    const flush = await runtime.flush();
    expect(flush.failed).toBe(false);
    expect(flush.writtenSpans).toBe(1);
    expect(flaky.attempts).toBeGreaterThanOrEqual(3);
    await runtime.shutdown();
  });

  test('keeps the business result during a storage outage and records recovery drops', async () => {
    let available = false;
    const parameters: unknown[][] = [];
    const transaction = {
      unsafe: async (sql: string, values?: unknown[]) => {
        void sql;
        parameters.push(values ?? []);
        return [];
      },
      array(values: unknown[], type: string) {
        return { serializedValues: JSON.stringify(values), arrayType: type };
      },
    };
    const database = {
      begin: async <T>(
        operation: (value: typeof transaction) => Promise<T>,
      ) => {
        if (!available) throw new Error('telemetry database unavailable');
        return operation(transaction);
      },
    };
    const runtime = new TelemetryRuntime({
      serviceName: 'test',
      serviceInstanceId: 'test-outage',
      signalStore: createPostgresObservabilitySignalStore({
        telemetryDatabase: database as never,
      }),
    });

    const businessResult = runtime.withSpan(
      {
        resourceKind: 'business.operation',
        resourceName: 'test.outage',
        operation: 'run',
        forceSample: true,
      },
      () => 'business-result',
    );
    expect(businessResult).toBe('business-result');

    const failed = await runtime.flush();
    expect(failed.failed).toBe(true);
    expect(failed.droppedItems).toBeGreaterThan(0);

    available = true;
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const recovered = await runtime.flush();
    expect(recovered.failed).toBe(false);
    expect(recovered.writtenMetricBuckets).toBeGreaterThan(0);
    expect(
      parameters
        .flat()
        .some((value) => value === 'telemetry.flush.recovery_dropped_total'),
    ).toBe(true);
    await runtime.shutdown();
  });

  test('keeps producer failures local when the shared queue applies pressure', async () => {
    const signalStore = new FakeObservabilitySignalStore({ maxItems: 4 });
    const runtime = new TelemetryRuntime({
      serviceName: 'test',
      serviceInstanceId: 'test-limits',
      maxSpansPerTrace: 1,
      signalStore,
    });
    const parent = runtime.startSpan({
      resourceKind: 'business.operation',
      resourceName: 'test.parent',
      operation: 'run',
      forceSample: true,
    });
    parent.end({ status: 'ok' });
    expect(() =>
      runtime.withSpan(
        {
          resourceKind: 'business.operation',
          resourceName: 'test.large',
          operation: 'run',
          forceSample: true,
          attributes: { safe_attribute: 'x'.repeat(256) },
        },
        () => 'business-result',
      ),
    ).not.toThrow();
    for (let index = 0; index < 5; index += 1) {
      runtime.withSpan(
        {
          resourceKind: 'business.operation',
          resourceName: 'test.queue-pressure',
          operation: 'run',
          forceSample: true,
        },
        () => undefined,
      );
    }
    expect(runtime.diagnostics().droppedItems).toBeGreaterThan(0);
    await runtime.shutdown();
  });

  test('keeps a storage batch failure outside the business outcome', async () => {
    const poison = poisonMetricDatabase();
    const runtime = new TelemetryRuntime({
      serviceName: 'test',
      serviceInstanceId: 'test-poison',
      signalStore: createPostgresObservabilitySignalStore({
        telemetryDatabase: poison.database,
      }),
    });
    runtime.withSpan(
      {
        resourceKind: 'business.operation',
        resourceName: 'test.good',
        operation: 'run',
        forceSample: true,
      },
      () => undefined,
    );
    runtime.recordHistogram('telemetry.operation.duration_ns', 1);
    const flush = await runtime.flush();
    expect(flush.failed).toBe(true);
    expect(flush.writtenSpans).toBe(1);
    expect(flush.droppedItems).toBeGreaterThan(0);
    expect(poison.attempts).toBeGreaterThan(0);
    await runtime.shutdown();
  });

  test('adjusts sampling without failing under critical memory pressure', async () => {
    const runtime = new TelemetryRuntime({
      serviceName: 'test',
      serviceInstanceId: 'test-memory',
    });
    for (let index = 0; index < 4; index += 1) {
      runtime.withSpan(
        {
          resourceKind: 'business.operation',
          resourceName: 'test.queue',
          operation: 'run',
          forceSample: true,
        },
        () => undefined,
      );
    }
    runtime.handleMemoryPressure('critical');
    expect(runtime.diagnostics().queueDepth).toBe(0);
    runtime.handleMemoryPressure('normal');
    await runtime.shutdown();
  });
});
