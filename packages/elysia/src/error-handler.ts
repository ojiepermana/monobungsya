import { Elysia } from 'elysia';
import { toErrorResponse, ValidationError } from '#project/errors';

export function createErrorHandler(name = 'error-handler') {
  return new Elysia({ name }).onError(({ code, error, request, set }) => {
    const mapped = toErrorResponse(
      code === 'VALIDATION'
        ? new ValidationError('Request validation failed')
        : error,
      request.headers.get('x-request-id') ?? undefined,
    );
    set.status = mapped.status;
    return mapped.body;
  });
}
