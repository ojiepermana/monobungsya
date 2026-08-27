import { Elysia } from 'elysia';
import type { DatabaseClient } from '#project/database';
import { LogsRepository } from './logs.repository';
import {
  accessLogsQuery,
  accessLogsResponse,
  applicationLogsQuery,
  applicationLogsResponse,
  auditTrailsQuery,
  auditTrailsResponse,
} from './logs.schema';
import { LogsService } from './logs.service';

export interface LogsRouteOptions {
  database?: DatabaseClient;
}

export function createLogsRoute(options: LogsRouteOptions = {}) {
  const repository = new LogsRepository(options.database);
  const service = new LogsService(repository);

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
      ({ query }) => service.getAccessLogs(query),
      {
        query: accessLogsQuery,
        response: { 200: accessLogsResponse },
        detail: {
          tags: ['Logs'],
          summary: 'List access logs with filters and paging',
        },
      },
    )
    .get(
      '/internal/logs/application-logs',
      ({ query }) => service.getApplicationLogs(query),
      {
        query: applicationLogsQuery,
        response: { 200: applicationLogsResponse },
        detail: {
          tags: ['Logs'],
          summary: 'List application logs with filters and paging',
        },
      },
    );
}
