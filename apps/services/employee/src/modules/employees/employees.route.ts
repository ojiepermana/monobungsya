import { Elysia } from 'elysia';
import { employeesStatusResponse } from './employees.schema';
import { EmployeesService } from './employees.service';

export function createEmployeesRoute(serviceName: string) {
  const service = new EmployeesService(serviceName);

  return new Elysia({ name: 'employees-routes' }).get(
    '/internal/employees/status',
    () => service.getStatus(),
    {
      response: { 200: employeesStatusResponse },
      detail: {
        tags: ['Employees'],
        summary: 'Return employees module status',
      },
    },
  );
}
