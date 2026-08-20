import { openapi } from '@elysiajs/openapi';

export const openapiPlugin = openapi({
  documentation: {
    info: {
      title: 'Payroll Service API',
      version: '0.1.0',
      description: 'Internal HTTP contract for the payroll service.',
    },
    tags: [
      { name: 'Health', description: 'Service health checks' },
      { name: 'Payroll', description: 'Payroll module' },
    ],
  },
});
