import { describe, expect, test } from 'bun:test';
import type { DatabaseClient } from '#project/database';
import { NotificationService } from './notification.service';

const userId = '0198f8a0-0000-7000-8000-000000000001';
const deliveryId = '0198f8a0-0000-7000-8000-000000000002';
const notificationId = '0198f8a0-0000-7000-8000-000000000003';
const jobId = '0198f8a0-0000-7000-8000-000000000004';

function createDatabase(
  options: {
    recipientActive?: boolean;
    emailEnabled?: boolean;
    recipientRows?: Array<{ user_id: string; email: string; active: boolean }>;
    observabilityRecipientRows?: Array<{ user_id: string }>;
  } = {},
) {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const database = (async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    const query = strings.raw.join('?');
    calls.push({ query, values });

    if (query.includes('SELECT user_id, email, active')) {
      return (
        options.recipientRows ?? [
          {
            user_id: userId,
            email: 'admin@local.app',
            active: options.recipientActive ?? true,
          },
        ]
      );
    }
    if (query.includes('WHERE active = true AND can_read_jobs = true')) {
      return [{ user_id: userId }];
    }
    if (
      query.includes('WHERE active = true AND can_read_observability = true')
    ) {
      return options.observabilityRecipientRows ?? [];
    }
    if (query.includes('INSERT INTO notification.notification (')) {
      return [
        {
          id: notificationId,
          user_id: userId,
          category: 'security',
          severity: 'info',
          type: 'security.sign_in',
          title: 'Aktivitas keamanan baru',
          body: 'Login berhasil.',
          metadata: { authMethod: 'passkey' },
          action_route: '/setting/passkeys',
          read_at: null,
          created_at: '2026-08-25 00:00:00',
        },
      ];
    }
    if (query.includes('INSERT INTO notification.notification_delivery')) {
      return [{ id: deliveryId }];
    }
    if (query.includes('SELECT delivery.id')) {
      return [
        {
          id: deliveryId,
          status: 'queued',
          recipient_email: 'admin@local.app',
          title: 'Aktivitas keamanan baru',
          body: 'Login berhasil.',
        },
      ];
    }
    if (query.includes('SELECT * FROM jobs.enqueue_job')) {
      return [{ id: '0198f8a0-0000-7000-8000-000000000004' }];
    }
    if (
      query.includes('SELECT enabled FROM notification.notification_preference')
    ) {
      return options.emailEnabled === undefined
        ? []
        : [{ enabled: options.emailEnabled }];
    }
    return [];
  }) as unknown as DatabaseClient;

  return { calls, database };
}

describe('NotificationService JSONB boundaries', () => {
  test('AC-4 passes metadata and email job payloads as objects', async () => {
    const { calls, database } = createDatabase();
    const service = new NotificationService(database);

    await service.create({
      userId,
      type: 'security.sign_in',
      version: 1,
      payload: {
        authMethod: 'passkey',
        browser: 'browser',
        platform: 'device',
        maskedIp: '192.0.2.1',
      },
      occurredAt: '2026-08-25T00:00:00.000Z',
      correlationId: 'notification-test',
    });

    const notificationInsert = calls.find((call) =>
      call.query.includes('INSERT INTO notification.notification ('),
    );
    const emailEnqueue = calls.find((call) =>
      call.query.includes('SELECT * FROM jobs.enqueue_job'),
    );

    expect(notificationInsert?.values).toContainEqual({
      authMethod: 'passkey',
      browser: 'browser',
      platform: 'device',
      maskedIp: '192.0.2.1',
    });
    expect(emailEnqueue?.values).toContainEqual({
      notificationDeliveryId: deliveryId,
    });
  });

  test('AC-4 creates idempotent deliveries and skips an opted-out optional email', async () => {
    const { calls, database } = createDatabase({ emailEnabled: false });
    const service = new NotificationService(database);

    await service.create({
      userId,
      type: 'security.sign_in',
      version: 1,
      payload: { authMethod: 'passkey' },
      occurredAt: '2026-08-25T00:00:00.000Z',
    });

    const deliveries = calls.filter((call) =>
      call.query.includes('INSERT INTO notification.notification_delivery'),
    );
    expect(deliveries).toHaveLength(2);
    expect(deliveries.map((call) => call.values[2])).toEqual([
      'queued',
      'skipped',
    ]);
    expect(
      calls.filter((call) => call.query.includes('jobs.enqueue_job')),
    ).toHaveLength(0);
  });

  test('AC-4 does not deliver non-account notifications to inactive recipients', async () => {
    const { calls, database } = createDatabase({ recipientActive: false });
    const service = new NotificationService(database);

    const result = await service.create({
      userId,
      type: 'security.sign_in',
      version: 1,
      payload: { authMethod: 'passkey' },
      occurredAt: '2026-08-25T00:00:00.000Z',
    });

    expect(result).toBeNull();
    expect(
      calls.some((call) =>
        call.query.includes('INSERT INTO notification.notification ('),
      ),
    ).toBe(false);
  });

  test('AC-4 keeps mandatory account email enabled and rejects disabling mandatory channels', async () => {
    const { calls, database } = createDatabase({ emailEnabled: false });
    const service = new NotificationService(database);

    await service.create({
      userId,
      type: 'account.status_changed',
      version: 1,
      payload: { status: 'suspended' },
      occurredAt: '2026-08-25T00:00:00.000Z',
    });

    const deliveries = calls.filter((call) =>
      call.query.includes('INSERT INTO notification.notification_delivery'),
    );
    expect(deliveries.map((call) => call.values[2])).toEqual([
      'queued',
      'queued',
    ]);
    await expect(
      service.updatePreference(userId, 'account', 'email', false),
    ).rejects.toThrow('mandatory');
  });

  test('AC-9 sends queued email and records provider failures', async () => {
    const sentCalls: Array<{ recipient: string; title: string; body: string }> =
      [];
    const { calls, database } = createDatabase();
    const service = new NotificationService(database, {
      send: async (input) => {
        sentCalls.push(input);
        return 'provider-message-1';
      },
    });

    await service.sendEmail({ notificationDeliveryId: deliveryId });
    expect(sentCalls).toEqual([
      {
        recipient: 'admin@local.app',
        title: 'Aktivitas keamanan baru',
        body: 'Login berhasil.',
      },
    ]);
    expect(calls.some((call) => call.query.includes("status = 'sent'"))).toBe(
      true,
    );

    const failingDatabase = (async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const query = strings.raw.join('?');
      calls.push({ query, values });
      if (query.includes('SELECT delivery.id')) {
        return [
          {
            id: deliveryId,
            status: 'queued',
            recipient_email: 'admin@local.app',
            title: 'Aktivitas keamanan baru',
            body: 'Login berhasil.',
          },
        ];
      }
      return [];
    }) as unknown as DatabaseClient;
    const failingService = new NotificationService(failingDatabase, {
      send: async () => {
        throw new Error('SMTP unavailable');
      },
    });

    await expect(
      failingService.sendEmail({ notificationDeliveryId: deliveryId }),
    ).rejects.toThrow('SMTP unavailable');
    expect(
      calls.some((call) =>
        call.query.includes("error_code = 'provider_error'"),
      ),
    ).toBe(true);
  });

  test('AC-16 fans out job failures only to active job readers', async () => {
    const { calls, database } = createDatabase({
      recipientRows: [
        { user_id: userId, email: 'admin@local.app', active: true },
      ],
    });
    const service = new NotificationService(database);

    await service.fanoutJobFailure({
      jobId,
      jobType: 'auth.cleanup',
      attemptCount: 5,
      failedAt: '2026-08-25T00:00:00.000Z',
    });

    expect(
      calls.some((call) => call.query.includes('WHERE active = true')),
    ).toBe(true);
    expect(
      calls.some((call) =>
        call.query.includes('INSERT INTO notification.notification ('),
      ),
    ).toBe(true);
  });

  test('fans out observability alerts only to current observability readers', async () => {
    const { calls, database } = createDatabase({
      observabilityRecipientRows: [{ user_id: userId }],
    });
    const service = new NotificationService(database);

    await service.fanoutObservabilityAlert({
      ruleId: 'telemetry.latency.p95',
      ruleVersion: '0014.1',
      severity: 'warning',
      service: 'gateway',
      transition: 'firing',
      transitionSequence: 1,
      evaluatedAt: '2026-08-25T00:00:00.000Z',
    });

    const notificationInsert = calls.find((call) =>
      call.query.includes('INSERT INTO notification.notification ('),
    );
    expect(
      calls.some((call) =>
        call.query.includes(
          'WHERE active = true AND can_read_observability = true',
        ),
      ),
    ).toBe(true);
    expect(notificationInsert?.values).toContainEqual({
      ruleId: 'telemetry.latency.p95',
      severity: 'warning',
      service: 'gateway',
      transition: 'firing',
      evaluatedAt: '2026-08-25T00:00:00.000Z',
    });

    const revoked = createDatabase({ observabilityRecipientRows: [] });
    await new NotificationService(revoked.database).fanoutObservabilityAlert({
      ruleId: 'telemetry.latency.p95',
      ruleVersion: '0014.1',
      severity: 'warning',
      service: 'gateway',
      transition: 'firing',
      transitionSequence: 2,
      evaluatedAt: '2026-08-25T00:05:00.000Z',
    });
    expect(
      revoked.calls.some((call) =>
        call.query.includes('INSERT INTO notification.notification ('),
      ),
    ).toBe(false);
  });
});
