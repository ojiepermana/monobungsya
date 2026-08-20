import { Elysia } from 'elysia';
import { type Logger, redactRequestUrl } from '#project/logger';

export function createLoggerPlugin(logger: Logger) {
  return new Elysia({ name: 'payroll-logger' }).onRequest(({ request }) => {
    logger.info('request.received', {
      method: request.method,
      url: redactRequestUrl(request.url),
      requestId: request.headers.get('x-request-id'),
      correlationId: request.headers.get('x-correlation-id'),
    });
  });
}
