import { expect, test } from 'bun:test';
import { redactRequestUrl } from './index';

test('redacts sensitive query parameters from request URLs', () => {
  expect(
    redactRequestUrl(
      'http://localhost/internal/auth/verify?token=raw-secret&state=kept',
    ),
  ).toBe(
    'http://localhost/internal/auth/verify?token=%5BREDACTED%5D&state=kept',
  );
});
