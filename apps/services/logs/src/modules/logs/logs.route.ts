import { Elysia } from 'elysia';
import type { DatabaseClient } from '#project/database';
import { RateLimitError, toErrorResponse } from '#project/errors';
import {
  type ClickHouseSignalReader,
  ClickHouseSignalReadQuotaError,
  type ObservabilitySignalReadMode,
  type ObservabilitySignalStore,
} from '#project/observability';
import type { TelemetryRuntime } from '#project/telemetry';
import { LogsRepository } from './logs.repository';
import {
  accessLogsQuery,
  accessLogsResponse,
  applicationLogsQuery,
  applicationLogsResponse,
  auditTrailsQuery,
  auditTrailsResponse,
  rateLimitResponse,
} from './logs.schema';
import { LogsService } from './logs.service';

export interface LogsRouteOptions {
  clickhouseReader?: ClickHouseSignalReader | null;
  database?: DatabaseClient;
  readMode?: ObservabilitySignalReadMode;
  signalStore?: ObservabilitySignalStore;
  telemetry?: TelemetryRuntime;
}

interface RateLimitResponseBody {
  error: {
    code: 'RATE_LIMITED';
    message: string;
    reason?: string;
    requestId?: string;
  };
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

export function createLogsRoute(options: LogsRouteOptions = {}) {
  const repository = new LogsRepository(options.database, options.telemetry, {
    clickhouseReader: options.clickhouseReader,
    readMode: options.readMode,
  });
  const service = new LogsService(repository, undefined, options.signalStore);

  return new Elysia({ name: 'logs-routes' })
    .get(
      '/internal/logs/audit-trails',
      ({ query }) => service.getAuditTrails(query),
      {
        query: auditTrailsQuery,
        response: { 200: auditTrailsResponse },
        detail: {
          tags: ['Logs'],
          summary: 'List audit trails with filters and paging',
        },
      },
    )
    .get(
      '/internal/logs/access-logs',
      async ({ query, request, set, status }) => {
        try {
          return await service.getAccessLogs(query);
        } catch (error) {
          const quota = quotaResponse(error, request);
          if (!quota) throw error;
          set.headers['retry-after'] = String(quota.retryAfterSeconds);
          return status(429, quota.body);
        }
      },
      {
        query: accessLogsQuery,
        response: { 200: accessLogsResponse, 429: rateLimitResponse },
        detail: {
          tags: ['Logs'],
          summary: 'List access logs with filters and paging',
        },
      },
    )
    .get(
      '/internal/logs/application-logs',
      async ({ query, request, set, status }) => {
        try {
          return await service.getApplicationLogs(query);
        } catch (error) {
          const quota = quotaResponse(error, request);
          if (!quota) throw error;
          set.headers['retry-after'] = String(quota.retryAfterSeconds);
          return status(429, quota.body);
        }
      },
      {
        query: applicationLogsQuery,
        response: { 200: applicationLogsResponse, 429: rateLimitResponse },
        detail: {
          tags: ['Logs'],
          summary: 'List application logs with filters and paging',
        },
      },
    );
}
