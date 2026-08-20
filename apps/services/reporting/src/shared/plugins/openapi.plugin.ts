import { openapi } from '@elysiajs/openapi';

export const openapiPlugin = openapi({
  documentation: {
    info: {
      title: 'Reporting Service API',
      version: '0.1.0',
      description: 'Internal HTTP contract for the reporting service.',
    },
    tags: [
      { name: 'Health', description: 'Service health checks' },
      { name: 'Reports', description: 'Reporting module' },
    ],
  },
});
