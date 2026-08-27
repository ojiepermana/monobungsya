import { Elysia } from 'elysia';
import type { DatabaseClient } from '#project/database';
import { LogsRepository } from './logs.repository';
import { auditTrailsQuery, auditTrailsResponse } from './logs.schema';
import { LogsService } from './logs.service';

export interface LogsRouteOptions {
  database?: DatabaseClient;
}

export function createLogsRoute(options: LogsRouteOptions = {}) {
  const repository = new LogsRepository(options.database);
  const service = new LogsService(repository);

  return new Elysia({ name: 'logs-routes' }).get(
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
  );
}
