import { describe, expect, test } from 'bun:test';
import type { DatabaseClient } from '#project/database';
import { authNotificationCreateContract, JobRegistry } from '#project/jobs';
import {
  DurableAuthNotificationSink,
  securityContextFromRequest,
} from './auth.notifications';

const userId = '0198f8a0-0000-7000-8000-000000000001';

describe('auth security notification boundary', () => {
  test('AC-12 normalizes browser, platform, and IP without retaining raw request data', () => {
    const context = securityContextFromRequest(
      new Request('http://localhost/internal/auth/logout', {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
          'x-forwarded-for': '203.0.113.42',
          'x-request-id': 'request-security',
        },
      }),
      'session_cookie',
    );

    expect(context).toEqual({
      authMethod: 'session_cookie',
      browser: 'Chrome',
      platform: 'macOS',
      maskedIp: '203.0.113.0',
      correlationId: 'request-security',
    });
    expect(JSON.stringify(context)).not.toContain('Macintosh');
    expect(JSON.stringify(context)).not.toContain('203.0.113.42');
  });

  test('AC-6 enqueues a typed auth event with normalized fields only', async () => {
    const calls: unknown[][] = [];
    const transaction = (async (
      _strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      calls.push(values);
      return [{ id: '0198f8a0-0000-7000-8000-000000000002' }];
    }) as unknown as DatabaseClient;
    const registry = new JobRegistry();
    registry.registerContract(authNotificationCreateContract);
    const sink = new DurableAuthNotificationSink(registry);

    await sink.enqueue(transaction, {
      userId,
      type: 'security.sign_in',
      payload: { action: 'ditambahkan' },
      context: {
        authMethod: 'passkey',
        browser: 'Chrome',
        platform: 'macOS',
        maskedIp: '203.0.113.0',
        correlationId: 'request-security',
      },
    });

    const values = calls[0] ?? [];
    expect(values[0]).toBe('auth.notification.create');
    expect(values[2]).toMatchObject({
      payload: {
        action: 'ditambahkan',
        authMethod: 'passkey',
        browser: 'Chrome',
        platform: 'macOS',
        maskedIp: '203.0.113.0',
      },
    });
    expect(values).toContain(userId);
    expect(values).toContain('auth');
    expect(values).toContain('notification');
    expect(JSON.stringify(values)).not.toContain('never-store-this');
    expect(JSON.stringify(values)).toContain('203.0.113.0');
    expect(JSON.stringify(values)).not.toContain('203.0.113.42');
  });
});
