import { openapi } from '@elysiajs/openapi';

export const openapiPlugin = openapi({
  documentation: {
    info: {
      title: 'Auth Service API',
      version: '0.1.0',
      description: 'Internal HTTP contract for the auth service.',
    },
    tags: [
      { name: 'Health', description: 'Service health checks' },
      { name: 'Auth', description: 'Auth module' },
    ],
  },
});
