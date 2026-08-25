import { describe, expect, it } from 'bun:test';
import { Buffer } from 'node:buffer';
import { loadEnv } from '#project/config';
import { signAuthIdentity } from '#project/contracts';
import type { DatabaseClient } from '#project/database';
import { createApp } from '../app';
import { ObservabilityRepository } from '../modules/observability/observability.repository';

interface RecordedQuery {
  text: string;
  params: unknown[];
}

function fakeDatabase(respond: (query: RecordedQuery) => unknown[]) {
  const queries: RecordedQuery[] = [];
  const database = {
    unsafe(text: string, params: unknown[] = []) {
      queries.push({ text, params });
      return Promise.resolve(respond({ text, params }));
    },
  } as unknown as DatabaseClient;
  return { database, queries };
}

describe('observability read surface', () => {
  const testEnv = (extra: Record<string, string> = {}) =>
    loadEnv('logs', { NODE_ENV: 'test', PORT: '3103', ...extra });

  it('returns an empty trace page when telemetry storage is unavailable', async () => {
    const app = createApp(testEnv());
    const response = await app.handle(
      new Request('http://localhost/internal/observability/traces'),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [],
      nextCursor: null,
      completeness: 'partial',
      storageStatus: 'blind_spot',
    });
  });

  it('exposes empty projections as an explicit blind spot without telemetry storage', async () => {
    const app = createApp(testEnv());
    const paths = [
      '/internal/observability/metrics',
      '/internal/observability/benchmarks/runs',
      '/internal/observability/benchmarks/baselines',
      '/internal/observability/alerts',
    ];
    for (const path of paths) {
      const response = await app.handle(new Request(`http://localhost${path}`));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toEqual([]);
      if (path.endsWith('/runs')) expect(body.nextCursor).toBeNull();
      if (path.endsWith('/metrics')) {
        expect(body.coverage).toMatchObject({
          expectedBuckets: 0,
          storedBuckets: 0,
          missingBuckets: 0,
          storageStatus: 'blind_spot',
        });
      } else {
        expect(body.storageStatus).toBe('blind_spot');
      }
    }
  });

  it('does not turn missing detail storage into a not-found result', async () => {
    const app = createApp(testEnv());
    const paths = [
      `/internal/observability/traces/${'a'.repeat(32)}`,
      '/internal/observability/benchmarks/runs/0198f8f8-0000-7000-8000-000000000001',
      '/internal/observability/alerts/telemetry.error_rate',
    ];
    for (const path of paths) {
      const response = await app.handle(new Request(`http://localhost${path}`));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          reason: 'observability_storage_blind_spot',
        },
      });
    }
  });

  it('reports a query outage as a blind spot instead of a false empty result', async () => {
    const database = {
      unsafe: async () => {
        throw new Error('connection refused');
      },
    } as unknown as DatabaseClient;
    const app = createApp(testEnv(), { telemetryDatabase: database });

    const listResponse = await app.handle(
      new Request('http://localhost/internal/observability/metrics'),
    );
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json()).coverage.storageStatus).toBe(
      'blind_spot',
    );

    const detailResponse = await app.handle(
      new Request(
        `http://localhost/internal/observability/traces/${'a'.repeat(32)}`,
      ),
    );
    expect(detailResponse.status).toBe(503);
    expect(await detailResponse.json()).toMatchObject({
      error: { reason: 'observability_storage_blind_spot' },
    });
  });

  it('bounds trace and metric query windows before touching storage', async () => {
    const app = createApp(testEnv());
    const traceResponse = await app.handle(
      new Request(
        'http://localhost/internal/observability/traces?from=2026-08-20T00:00:00Z&to=2026-08-25T00:00:00Z',
      ),
    );
    const metricResponse = await app.handle(
      new Request('http://localhost/internal/observability/metrics?step=30'),
    );
    expect(traceResponse.status).toBe(422);
    expect(metricResponse.status).toBe(422);
  });

  it('rejects unknown metrics and forbidden groups while accepting registry groups', async () => {
    const app = createApp(testEnv());
    const unknownMetric = await app.handle(
      new Request(
        'http://localhost/internal/observability/metrics?metric=not-a-real-metric',
      ),
    );
    expect(unknownMetric.status).toBe(422);

    const forbiddenGroup = await app.handle(
      new Request('http://localhost/internal/observability/metrics?group=sql'),
    );
    expect(forbiddenGroup.status).toBe(422);

    const allowedGroups = await app.handle(
      new Request(
        'http://localhost/internal/observability/metrics?group=service,status',
      ),
    );
    expect(allowedGroups.status).toBe(200);
  });

  it('rejects metric estimates above the configured series limit', async () => {
    const database = {
      unsafe: async (text: string) =>
        text.includes('series_count') ? [{ series_count: 2 }] : [],
    } as unknown as DatabaseClient;
    const app = createApp(testEnv(), {
      telemetryDatabase: database,
      observabilityMaxSeries: 1,
    });

    const response = await app.handle(
      new Request('http://localhost/internal/observability/metrics'),
    );
    expect(response.status).toBe(422);
  });

  it('keeps observability permission separate from the log permission', async () => {
    const secret = 'observability-signing-secret';
    const app = createApp(testEnv({ INTERNAL_AUTH_SIGNING_SECRET: secret }));
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const request = (permissions: string[]) => {
      const identity = {
        userId: '0198f8a0-0000-7000-8000-000000000001',
        email: 'operator@project.local',
        permissions,
        expiresAt,
      };
      const signature = signAuthIdentity(
        'GET',
        '/internal/observability/traces',
        identity,
        secret,
      );
      return new Request('http://localhost/internal/observability/traces', {
        headers: {
          'x-auth-user-id': identity.userId,
          'x-auth-email': identity.email,
          'x-auth-permissions': identity.permissions.join(','),
          'x-auth-expires-at': identity.expiresAt,
          'x-auth-signature': signature,
        },
      });
    };

    expect((await app.handle(request(['logs:log:read']))).status).toBe(403);
    expect(
      (await app.handle(request(['observability:telemetry:read']))).status,
    ).toBe(200);
  });
});

describe('observability repository', () => {
  it('groups trace spans and preserves a cursor boundary', async () => {
    const { database, queries } = fakeDatabase((query) => {
      if (query.text.includes('GROUP BY trace_id')) {
        return [
          {
            trace_id: 'a'.repeat(32),
            started_at: '2026-08-25 10:00:00.000',
            finished_at: '2026-08-25 10:00:00.100',
            duration_ns: 100_000_000,
            service_name: 'gateway',
            resource_name: 'GET /api/v1/users',
            status: 'ok',
            span_count: 1,
            sampling_reason: 'benchmark',
            has_root: true,
            correlation_id: 'req-1',
            request_id: 'req-1',
            run_id: null,
          },
        ];
      }
      return [];
    });

    const repository = new ObservabilityRepository(database);
    const result = await repository.listTraces({
      from: new Date('2026-08-25T09:00:00.000Z'),
      to: new Date('2026-08-25T11:00:00.000Z'),
      cursor: undefined,
    });

    expect(result.items[0]?.traceId).toBe('a'.repeat(32));
    expect(result.items[0]?.durationMs).toBe(100);
    expect(queries[0]?.text).toContain('started_at >= $1');
    expect(queries[0]?.text).toContain(
      '(array_agg(run_id ORDER BY started_at DESC NULLS LAST))[1]::text AS run_id',
    );
    expect(queries[0]?.text).not.toContain('max(run_id)');
    expect(queries[0]?.params[0]).toEqual(new Date('2026-08-25T09:00:00.000Z'));
  });

  it('filters alert scope and paginates with the mixed sort direction', async () => {
    const { database, queries } = fakeDatabase(() => [
      {
        rule_id: 'telemetry.error.rate',
        rule_version: '0014.1',
        series_fingerprint: 'a'.repeat(64),
        service_name: 'jobs',
        resource_kind: 'job.execute',
        resource_name: 'jobs.run',
        status: 'firing',
        consecutive_breach_windows: 3,
        consecutive_healthy_windows: 0,
        transition_sequence: 1,
        first_breached_at: '2026-08-25 10:00:00.000',
        last_evaluated_at: '2026-08-25 10:00:00.000',
        evidence_bucket: '2026-08-25 09:55:00.000',
        last_notified_at: null,
        resolved_at: null,
        title: 'Runtime error rate',
        severity: 'critical',
        metric: 'telemetry.errors.total',
        threshold: 0.05,
        window_seconds: 300,
        manifest_checksum: 'b'.repeat(64),
      },
    ]);
    const repository = new ObservabilityRepository(database);
    const cursor = Buffer.from(
      `2026-08-25 10:05:00.000|telemetry.error.rate|${'c'.repeat(64)}`,
    ).toString('base64');

    const result = await repository.listAlerts({
      severity: 'critical',
      service: 'jobs',
      cursor,
    });

    expect(result.data[0]).toMatchObject({
      serviceName: 'jobs',
      resourceKind: 'job.execute',
      resourceName: 'jobs.run',
      severity: 'critical',
    });
    expect(result.nextCursor).toBeNull();
    expect(queries[0]?.text).toContain('rules.severity = $1');
    expect(queries[0]?.text).toContain('state.service_name = $2');
    expect(queries[0]?.text).toContain('state.last_evaluated_at < $3');
    expect(queries[0]?.text).toContain('state.rule_id > $4');
    expect(queries[0]?.text).toContain('state.series_fingerprint > $5');
    expect(queries[0]?.params).toEqual([
      'critical',
      'jobs',
      '2026-08-25 10:05:00.000',
      'telemetry.error.rate',
      'c'.repeat(64),
      51,
    ]);
  });
});
