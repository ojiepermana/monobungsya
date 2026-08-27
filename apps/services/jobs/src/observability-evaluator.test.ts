import { describe, expect, it } from 'bun:test';
import type { DatabaseClient } from '#project/database';
import {
  JobRegistry,
  observabilityAlertNotificationContract,
} from '#project/jobs';
import { ObservabilityAlertEvaluator } from './observability-evaluator';

interface StoredAlertState {
  status: string;
  consecutive_breach_windows: number;
  consecutive_healthy_windows: number;
  transition_sequence: number;
  first_breached_at: string | null;
  last_evaluated_at: string;
  evidence_bucket: string | null;
  last_notified_at: string | null;
  resolved_at: string | null;
}

function metricRow(
  metric: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    bucket_start: '2026-08-25T00:10:00.000Z',
    service_name: 'gateway',
    resource_kind: 'business.operation',
    resource_name: 'runtime',
    series_fingerprint: `${metric}-fingerprint`,
    count: 20,
    sum: 20,
    histogram_boundaries: [500, 1000, 2000],
    histogram_counts: [0, 0, 20],
    labels: { status: 'error' },
    ...overrides,
  };
}

function createEvaluatorDatabase() {
  const states = new Map<string, StoredAlertState>();
  const notificationQueries: unknown[][] = [];
  const rowsByMetric: Record<string, Record<string, unknown>[]> = {
    'telemetry.operation.duration_ns': [
      metricRow('telemetry.operation.duration_ns', {
        resource_name: 'benchmark.latency',
        labels: { status: 'ok' },
      }),
    ],
    'telemetry.operation.count': [
      metricRow('telemetry.operation.count', {
        resource_name: 'benchmark.errors',
      }),
    ],
    'telemetry.items.dropped_total': [
      metricRow('telemetry.items.dropped_total', {
        count: 1,
        sum: 1,
        resource_name: 'telemetry.queue',
        labels: {},
      }),
    ],
    'telemetry.errors.total': [
      metricRow('telemetry.errors.total', {
        count: 1,
        sum: 1,
        resource_name: 'observability.alert.evaluate',
      }),
    ],
    'telemetry.memory_pressure.critical_total': [
      metricRow('telemetry.memory_pressure.critical_total', {
        count: 1,
        sum: 1,
        resource_name: 'runtime.memory',
        labels: {},
      }),
    ],
  };

  const query = async (
    _strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    notificationQueries.push(values);
    return [{ id: `job-${notificationQueries.length}`, status: 'queued' }];
  };

  const unsafe = async (
    sql: string,
    values: unknown[] = [],
  ): Promise<unknown[]> => {
    if (sql.includes('FROM "telemetry"."metric_buckets"')) {
      return rowsByMetric[String(values[0])] ?? [];
    }
    if (sql.includes('FROM "telemetry"."alert_states"')) {
      const state = states.get(`${values[0]}|${values[1]}|${values[2]}`);
      return state ? [state] : [];
    }
    if (sql.includes('INSERT INTO "telemetry"."alert_states"')) {
      states.set(`${values[0]}|${values[1]}|${values[2]}`, {
        status: String(values[6]),
        consecutive_breach_windows: Number(values[7]),
        consecutive_healthy_windows: Number(values[8]),
        transition_sequence: Number(values[9]),
        first_breached_at: values[10] ? String(values[10]) : null,
        last_evaluated_at: String(values[11]),
        evidence_bucket: values[12] ? String(values[12]) : null,
        last_notified_at: values[13] ? String(values[13]) : null,
        resolved_at: values[14] ? String(values[14]) : null,
      });
    }
    return [];
  };

  const transaction = Object.assign(query, { unsafe });
  const database = Object.assign(query, {
    unsafe,
    begin: async (
      operation: (transaction: DatabaseClient) => Promise<unknown>,
    ) => operation(transaction as unknown as DatabaseClient),
  }) as unknown as DatabaseClient;

  return { database, notificationQueries, states };
}

describe('ObservabilityAlertEvaluator', () => {
  it('persists three breach windows and enqueues one notification per firing transition', async () => {
    const { database, notificationQueries, states } = createEvaluatorDatabase();
    const registry = new JobRegistry();
    registry.registerContract(observabilityAlertNotificationContract);
    const evaluator = new ObservabilityAlertEvaluator(
      database,
      registry,
      'benchmarks/alert-rules.json',
    );

    const first = await evaluator.evaluate(new Date('2026-08-25T00:10:00Z'));
    const second = await evaluator.evaluate(new Date('2026-08-25T00:15:00Z'));
    const third = await evaluator.evaluate(new Date('2026-08-25T00:20:00Z'));
    const repeated = await evaluator.evaluate(new Date('2026-08-25T00:25:00Z'));

    expect(first).toBe(0);
    expect(second).toBe(0);
    expect(third).toBe(6);
    expect(repeated).toBe(0);
    expect(notificationQueries).toHaveLength(6);
    expect(
      [...states.values()].every((state) => state.status === 'firing'),
    ).toBe(true);
    expect(
      [...states.values()].every((state) => state.transition_sequence === 1),
    ).toBe(true);
  });
});
