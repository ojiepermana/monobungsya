import { expect, spyOn, test } from 'bun:test';
import { ActivityLog } from './activity-log';
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

test('persists the same sanitized warning with normalized level and error details', async () => {
  const consoleLog = spyOn(console, 'log').mockImplementation(() => {});
  const writeLog = spyOn(ActivityLog, 'writeLog').mockImplementation(
    () => undefined as never,
  );
  const logger = new Logger('auth', 'info', { persist: true });
  const error = new Error('database unavailable');

  logger.warn('auth.lookup.failed', {
    error,
    token: 'do not store',
    requestId: 'request-1',
    traceId: 'trace-1',
  });

  expect(writeLog).toHaveBeenCalledWith(
    expect.objectContaining({
      level: 'warning',
      event: 'auth.lookup.failed',
      module: 'auth',
      requestId: 'request-1',
      traceId: 'trace-1',
      exceptionClass: 'Error',
      exceptionMessage: 'database unavailable',
      context: expect.objectContaining({ token: '[REDACTED]' }),
    }),
  );
  expect(JSON.parse(String(consoleLog.mock.calls[0]?.[0]))).toMatchObject({
    level: 'warn',
    token: '[REDACTED]',
    exceptionMessage: 'database unavailable',
  });

  writeLog.mockRestore();
  consoleLog.mockRestore();
  await ActivityLog.flush();
});
