import { expect, test } from 'bun:test';
import { redactRequestUrl, sanitizeLogContext } from './index';

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
