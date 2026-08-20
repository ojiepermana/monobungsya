import { Elysia } from 'elysia';
import type { Logger } from '#project/logger';

export function createLoggerPlugin(logger: Logger) {
  return new Elysia({ name: 'reporting-logger' }).onRequest(({ request }) => {
    logger.info('request.received', {
      method: request.method,
      url: request.url,
      requestId: request.headers.get('x-request-id'),
      correlationId: request.headers.get('x-correlation-id'),
    });
  });
}
