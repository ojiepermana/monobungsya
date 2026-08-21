import { describe, expect, it, spyOn } from 'bun:test';
import { Elysia, t } from 'elysia';
import { UnauthorizedError } from '#project/errors';
import { Logger } from '#project/logger';
import { createErrorHandler } from './error-handler';

// Routes live in their own plugin instance, exactly like every service module,
// and the error handler is registered before them, exactly like every app root.
// Elysia dedupes plugins by name, so a variant that swaps options needs its own.
function createTestApp(options: { name?: string; logger?: Logger } = {}) {
  const routes = new Elysia({ name: 'test-routes' })
    .get('/throws', () => {
      throw new UnauthorizedError('A valid signed identity is required');
    })
    .get('/breaks', () => {
      throw new Error('connection string postgres://secret@db');
    })
    .post('/validates', ({ body }) => body, {
      body: t.Object({ email: t.String({ format: 'email' }) }),
    });

  return new Elysia()
    .use(
      createErrorHandler(
        options.name ?? 'test-error-handler',
        options.logger ? { logger: options.logger } : {},
      ),
    )
    .use(routes);
}

describe('createErrorHandler', () => {
  it('shapes an error thrown inside a route plugin into the JSON envelope', async () => {
    const response = await createTestApp().handle(
      new Request('http://localhost/throws'),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'A valid signed identity is required',
      },
    });
  });

  it('carries the incoming request id into the envelope', async () => {
    const response = await createTestApp().handle(
      new Request('http://localhost/throws', {
        headers: { 'x-request-id': 'request-123' },
      }),
    );

    expect(await response.json()).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'A valid signed identity is required',
        requestId: 'request-123',
      },
    });
  });

  it('maps Elysia validation failures onto the envelope', async () => {
    const response = await createTestApp().handle(
      new Request('http://localhost/validates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' }),
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' },
    });
  });

  it('maps unmatched routes onto the envelope', async () => {
    const response = await createTestApp().handle(
      new Request('http://localhost/missing'),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
  });

  it('hides unexpected failures behind a generic 500', async () => {
    const response = await createTestApp().handle(
      new Request('http://localhost/breaks'),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  });

  it('logs the mapped error when a logger is provided', async () => {
    const write = spyOn(console, 'log').mockImplementation(() => {});
    let lines: string[] = [];

    try {
      await createTestApp({
        name: 'test-logging-error-handler',
        logger: new Logger('test-service'),
      }).handle(new Request('http://localhost/throws'));
      // `mockRestore` also drops the recorded calls, so read them first.
      lines = write.mock.calls.map(([line]) => String(line));
    } finally {
      write.mockRestore();
    }

    const logged = lines.map((line) => JSON.parse(line));

    expect(logged).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: 'request.failed',
        error: {
          error: {
            code: 'UNAUTHORIZED',
            message: 'A valid signed identity is required',
          },
        },
      }),
    );
  });
});
