import { Elysia } from 'elysia';
import { payrollStatusResponse } from './payroll.schema';
import { PayrollService } from './payroll.service';

export function createPayrollRoute(serviceName: string) {
  const service = new PayrollService(serviceName);

  return new Elysia({ name: 'payroll-routes' }).get(
    '/internal/payroll/status',
    () => service.getStatus(),
    {
      response: { 200: payrollStatusResponse },
      detail: { tags: ['Payroll'], summary: 'Return payroll module status' },
    },
  );
}
