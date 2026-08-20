import { t } from 'elysia';

export const payrollStatusResponse = t.Object({
  service: t.String(),
  status: t.Literal('ok'),
  module: t.Literal('payroll'),
});
