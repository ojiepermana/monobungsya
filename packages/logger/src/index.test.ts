import { expect, spyOn, test } from 'bun:test';
import { Logger, redactRequestUrl, sanitizeLogContext } from './index';

test('redacts sensitive query parameters from request URLs', () => {
  expect(
    redactRequestUrl(
      'http://localhost/internal/auth/verify?token=raw-secret&state=kept',
    ),
  ).toBe(
    'http://localhost/internal/auth/verify?token=%5BREDACTED%5D&state=kept',
  );
});

test('sanitizes nested credentials while preserving correlation ids', () => {
  expect(
    sanitizeLogContext({
      Authorization: 'Bearer secret',
      sessionId: 'session-1',
      requestId: 'request-1',
      nested: [{ password: 'hidden', visible: 'kept' }],
    }),
  ).toEqual({
    Authorization: '[REDACTED]',
    sessionId: 'session-1',
    requestId: 'request-1',
    nested: [{ password: '[REDACTED]', visible: 'kept' }],
  });
});

test('writes a sanitized warning with normalized level and error details', () => {
  const consoleLog = spyOn(console, 'log').mockImplementation(() => {});
  const logger = new Logger('auth', 'info');
  const error = new Error('database unavailable');

  logger.warn('auth.lookup.failed', {
    error,
    token: 'do not store',
    requestId: 'request-1',
    traceId: 'trace-1',
  });

  expect(JSON.parse(String(consoleLog.mock.calls[0]?.[0]))).toMatchObject({
    level: 'warn',
    token: '[REDACTED]',
    exceptionMessage: 'database unavailable',
  });

  consoleLog.mockRestore();
});
