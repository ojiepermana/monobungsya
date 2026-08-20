import { Elysia, t } from 'elysia';
import type { AppEnvironment } from '#project/config';
import { loadEnv } from '#project/config';
import { toErrorResponse, ValidationError } from '#project/errors';
import { Logger } from '#project/logger';
import { createEmployeesRoute } from './modules/employees/employees.route';
import { createErrorHandler } from './shared/errors/error-handler';
import { createAuthIdentityPlugin } from './shared/plugins/auth-identity.plugin';
import { createLoggerPlugin } from './shared/plugins/logger.plugin';
import { openapiPlugin } from './shared/plugins/openapi.plugin';
import { requestIdPlugin } from './shared/plugins/request-id.plugin';

export function createApp(environment: AppEnvironment = loadEnv('employee')) {
  const logger = new Logger(environment.serviceName, environment.LOG_LEVEL);

  return new Elysia({ name: environment.serviceName })
    .use(requestIdPlugin)
    .use(createLoggerPlugin(logger))
    .use(openapiPlugin)
    .get(
      '/health',
      () => ({ status: 'ok' as const, service: environment.serviceName }),
      {
        response: {
          200: t.Object({ status: t.Literal('ok'), service: t.String() }),
        },
        detail: { tags: ['Health'], summary: 'Check service health' },
      },
    )
    .use(
      createAuthIdentityPlugin(
        environment.INTERNAL_AUTH_SIGNING_SECRET,
        environment.AUTH_CLOCK_SKEW_SECONDS,
      ),
    )
    .use(createEmployeesRoute(environment.serviceName))
    .use(createErrorHandler())
    .onError(({ code, error, request, set }) => {
      const mapped = toErrorResponse(
        code === 'VALIDATION'
          ? new ValidationError('Request validation failed')
          : error,
        request.headers.get('x-request-id') ?? undefined,
      );
      set.status = mapped.status;
      logger.error('request.failed', {
        requestId: request.headers.get('x-request-id'),
        error: mapped.body,
      });
      return mapped.body;
    });
}
