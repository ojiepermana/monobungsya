import { Elysia } from 'elysia';
import {
  NotFoundError,
  toErrorResponse,
  UnauthorizedError,
  ValidationError,
} from '#project/errors';
import type { Logger } from '#project/logger';

export interface ErrorHandlerOptions {
  logger?: Logger;
}

/**
 * Elysia's own errors (`VALIDATION`, `NOT_FOUND`, ...) are not `AppError`s, so
 * map them onto the shared taxonomy before `toErrorResponse` turns everything
 * it does not recognise into a 500.
 */
function toAppError(code: string | number, error: unknown): unknown {
  switch (code) {
    case 'VALIDATION':
      return new ValidationError('Request validation failed');
    case 'PARSE':
      return new ValidationError('Request body could not be parsed');
    case 'INVALID_FILE_TYPE':
      return new ValidationError('The uploaded file type is not allowed');
    case 'NOT_FOUND':
      return new NotFoundError();
    case 'INVALID_COOKIE_SIGNATURE':
      return new UnauthorizedError('The request cookie signature is invalid');
    default:
      return error;
  }
}

/**
 * Shapes every failed request into the shared JSON error envelope.
 *
 * Register this BEFORE any route plugin. Elysia only applies a lifecycle hook
 * to routes registered after it, and the default `local` scope never reaches
 * routes that live inside another plugin instance — a handler registered last
 * silently leaves plugin routes on Elysia's default (plain-text) error output.
 */
export function createErrorHandler(
  name = 'error-handler',
  options: ErrorHandlerOptions = {},
) {
  return new Elysia({ name }).onError(
    { as: 'global' },
    ({ code, error, request, set }) => {
      const requestId = request.headers.get('x-request-id') ?? undefined;
      const mapped = toErrorResponse(toAppError(code, error), requestId);

      set.status = mapped.status;
      options.logger?.error('request.failed', {
        requestId: requestId ?? null,
        error: mapped.body,
      });

      return mapped.body;
    },
  );
}
