import { Elysia } from 'elysia';
import { reportsStatusResponse } from './reporting.schema';
import { ReportingService } from './reporting.service';

export function createReportingRoute(serviceName: string) {
  const service = new ReportingService(serviceName);

  return new Elysia({ name: 'reporting-routes' }).get(
    '/internal/reports/status',
    () => service.getStatus(),
    {
      response: { 200: reportsStatusResponse },
      detail: { tags: ['Reports'], summary: 'Return reports module status' },
    },
  );
}
