import { Elysia, t } from 'elysia';
import type { DatabaseClient } from '#project/database';
import { RateLimitError, toErrorResponse } from '#project/errors';
import {
  type ClickHouseSignalReader,
  ClickHouseSignalReadQuotaError,
  type ObservabilitySignalReadMode,
} from '#project/observability';
import {
  type IngestionVerificationOptions,
  verifyIngestionRequest,
} from './observability.ingestion';
import { ObservabilityRepository } from './observability.repository';
import {
  alertDetailQuery,
  alertParams,
  alertsQuery,
  alertsResponse,
  benchmarkBaselinesQuery,
  benchmarkBaselinesResponse,
  benchmarkIngestionResponse,
  benchmarkRunParams,
  benchmarkRunResponse,
  benchmarkRunsQuery,
  benchmarkRunsResponse,
  metricsQuery,
  metricsResponse,
  traceDetailResponse,
  traceParams,
  tracesQuery,
  tracesResponse,
} from './observability.schema';
import { ObservabilityService } from './observability.service';

const rateLimitResponse = t.Object({
  error: t.Object({
    code: t.Literal('RATE_LIMITED'),
    message: t.String(),
    reason: t.Optional(t.String()),
    requestId: t.Optional(t.String()),
  }),
});

interface RateLimitResponseBody {
  error: {
    code: 'RATE_LIMITED';
    message: string;
    reason?: string;
    requestId?: string;
  };
}

export interface ObservabilityRouteOptions {
  clickhouseReader?: ClickHouseSignalReader | null;
  database?: DatabaseClient;
  ingestionKeys?: ReadonlyMap<string, string>;
  ingestionMaxBytes?: number;
  ingestionClockSkewSeconds?: number;
  queryTimeoutMs?: number;
  maxSeries?: number;
  readMode?: ObservabilitySignalReadMode;
}

function quotaResponse(error: unknown, request: Request) {
  if (!(error instanceof ClickHouseSignalReadQuotaError)) return null;
  return {
    body: toErrorResponse(
      new RateLimitError(),
      request.headers.get('x-request-id') ?? undefined,
    ).body as RateLimitResponseBody,
    retryAfterSeconds: error.retryAfterSeconds,
  };
}

export function createObservabilityRoute(
  options: ObservabilityRouteOptions = {},
) {
  const service = new ObservabilityService(
    new ObservabilityRepository(options.database, {
      clickhouseReader: options.clickhouseReader,
      queryTimeoutMs: options.queryTimeoutMs,
      maxSeries: options.maxSeries,
      readMode: options.readMode,
    }),
  );
  const ingestion: IngestionVerificationOptions = {
    keys: options.ingestionKeys ?? new Map(),
    maxBytes: options.ingestionMaxBytes ?? 5_242_880,
    clockSkewSeconds: options.ingestionClockSkewSeconds ?? 60,
  };

  return new Elysia({ name: 'observability-routes' })
    .post(
      '/internal/observability/benchmark-ingestions',
      ({ request, body }) =>
        service.ingestBenchmark(
          body,
          verifyIngestionRequest(request, body, ingestion),
        ),
      {
        body: t.Unknown(),
        response: { 200: benchmarkIngestionResponse },
        detail: {
          tags: ['Observability'],
          summary: 'Ingest a signed benchmark projection',
        },
      },
    )
    .get(
      '/internal/observability/traces',
      async ({ query, request, set, status }) => {
        try {
          return await service.listTraces(query);
        } catch (error) {
          const quota = quotaResponse(error, request);
          if (!quota) throw error;
          set.headers['retry-after'] = String(quota.retryAfterSeconds);
          return status(429, quota.body);
        }
      },
      {
        query: tracesQuery,
        response: { 200: tracesResponse, 429: rateLimitResponse },
        detail: {
          tags: ['Observability'],
          summary: 'List sampled runtime traces',
        },
      },
    )
    .get(
      '/internal/observability/traces/:traceId',
      async ({ params, request, set, status }) => {
        try {
          return await service.getTrace(params.traceId);
        } catch (error) {
          const quota = quotaResponse(error, request);
          if (!quota) throw error;
          set.headers['retry-after'] = String(quota.retryAfterSeconds);
          return status(429, quota.body);
        }
      },
      {
        params: traceParams,
        response: { 200: traceDetailResponse, 429: rateLimitResponse },
        detail: {
          tags: ['Observability'],
          summary: 'Read a runtime trace tree',
        },
      },
    )
    .get(
      '/internal/observability/metrics',
      async ({ query, request, set, status }) => {
        try {
          return await service.listMetrics(query);
        } catch (error) {
          const quota = quotaResponse(error, request);
          if (!quota) throw error;
          set.headers['retry-after'] = String(quota.retryAfterSeconds);
          return status(429, quota.body);
        }
      },
      {
        query: metricsQuery,
        response: { 200: metricsResponse, 429: rateLimitResponse },
        detail: {
          tags: ['Observability'],
          summary: 'Read aggregated runtime metrics',
        },
      },
    )
    .get(
      '/internal/observability/benchmarks/runs',
      ({ query }) => service.listBenchmarkRuns(query),
      {
        query: benchmarkRunsQuery,
        response: { 200: benchmarkRunsResponse },
        detail: { tags: ['Observability'], summary: 'List benchmark runs' },
      },
    )
    .get(
      '/internal/observability/benchmarks/runs/:runId',
      ({ params }) => service.getBenchmarkRun(params.runId),
      {
        params: benchmarkRunParams,
        response: { 200: benchmarkRunResponse },
        detail: {
          tags: ['Observability'],
          summary: 'Read a benchmark run and comparisons',
        },
      },
    )
    .get(
      '/internal/observability/benchmarks/baselines',
      ({ query }) => service.listBenchmarkBaselines(query),
      {
        query: benchmarkBaselinesQuery,
        response: { 200: benchmarkBaselinesResponse },
        detail: {
          tags: ['Observability'],
          summary: 'List benchmark baselines',
        },
      },
    )
    .get(
      '/internal/observability/alerts',
      ({ query }) => service.listAlerts(query),
      {
        query: alertsQuery,
        response: { 200: alertsResponse },
        detail: {
          tags: ['Observability'],
          summary: 'List runtime alert states',
        },
      },
    )
    .get(
      '/internal/observability/alerts/:ruleId',
      ({ params, query }) =>
        service.getAlertsForRule(params.ruleId, query.seriesFingerprint),
      {
        params: alertParams,
        query: alertDetailQuery,
        response: { 200: alertsResponse },
        detail: {
          tags: ['Observability'],
          summary: 'Read alert states for a rule',
        },
      },
    );
}
