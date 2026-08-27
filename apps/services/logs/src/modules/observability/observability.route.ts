import { Elysia, t } from 'elysia';
import type { DatabaseClient } from '#project/database';
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

export interface ObservabilityRouteOptions {
  database?: DatabaseClient;
  ingestionKeys?: ReadonlyMap<string, string>;
  ingestionMaxBytes?: number;
  ingestionClockSkewSeconds?: number;
  queryTimeoutMs?: number;
  maxSeries?: number;
}

export function createObservabilityRoute(
  options: ObservabilityRouteOptions = {},
) {
  const service = new ObservabilityService(
    new ObservabilityRepository(options.database, {
      queryTimeoutMs: options.queryTimeoutMs,
      maxSeries: options.maxSeries,
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
      ({ query }) => service.listTraces(query),
      {
        query: tracesQuery,
        response: { 200: tracesResponse },
        detail: {
          tags: ['Observability'],
          summary: 'List sampled runtime traces',
        },
      },
    )
    .get(
      '/internal/observability/traces/:traceId',
      ({ params }) => service.getTrace(params.traceId),
      {
        params: traceParams,
        response: { 200: traceDetailResponse },
        detail: {
          tags: ['Observability'],
          summary: 'Read a runtime trace tree',
        },
      },
    )
    .get(
      '/internal/observability/metrics',
      ({ query }) => service.listMetrics(query),
      {
        query: metricsQuery,
        response: { 200: metricsResponse },
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
