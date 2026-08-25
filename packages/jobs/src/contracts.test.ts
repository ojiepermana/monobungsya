import { describe, expect, test } from 'bun:test';
import {
  accessNotificationCreateContract,
  accessNotificationRecipientCapabilitySyncContract,
  authCleanupExpiredSecurityDataContract,
  authNotificationCreateContract,
  authSendUserInvitationContract,
  jobFailureNotificationContract,
  notificationCreateContract,
  notificationEmailDeliveryContract,
  notificationRecipientSyncContract,
} from './contracts';

const userId = '0198f8a0-0000-7000-8000-000000000001';
const jobId = '0198f8a0-0000-7000-8000-000000000002';
const deliveryId = '0198f8a0-0000-7000-8000-000000000003';
const occurredAt = '2026-08-25T00:00:00.000Z';
const jobContext = {} as never;

describe('durable job contracts', () => {
  test('AC-13 gives auth security events their own source boundary', () => {
    const payload = {
      userId,
      type: 'security.passkey_changed',
      version: 1,
      payload: { action: 'ditambahkan' },
      occurredAt,
    };

    expect(authNotificationCreateContract.sourceService).toBe('auth');
    expect(authNotificationCreateContract.targetService).toBe('notification');
    expect(authNotificationCreateContract.validate(payload)).toBe(true);
    expect(
      authNotificationCreateContract.validate({ ...payload, userId: 'bad' }),
    ).toBe(false);
  });
  test('AC-1 validates invitation and cleanup payloads and derives stable keys', () => {
    expect(authSendUserInvitationContract.validate({ userId })).toBe(true);
    expect(
      authSendUserInvitationContract.validate({ userId: 'not-a-uuid' }),
    ).toBe(true);
    expect(authSendUserInvitationContract.validate({})).toBe(false);
    expect(
      authSendUserInvitationContract.domainIdempotencyKey(
        { userId },
        jobContext,
      ),
    ).toBe(`user-invitation:${userId}`);

    expect(authCleanupExpiredSecurityDataContract.validate({})).toBe(true);
    expect(
      authCleanupExpiredSecurityDataContract.validate({ unexpected: true }),
    ).toBe(false);
    expect(authCleanupExpiredSecurityDataContract.schedules).toEqual([
      expect.objectContaining({
        code: 'auth.cleanup_expired_security_data',
        timezone: 'Asia/Jakarta',
        enabled: true,
      }),
    ]);
  });

  test('AC-4 validates notification payloads and rejects malformed identity data', () => {
    const payload = {
      userId,
      type: 'security.sign_in',
      version: 1,
      payload: { authMethod: 'passkey' },
      occurredAt,
      correlationId: 'request-1',
    };

    expect(notificationCreateContract.validate(payload)).toBe(true);
    expect(accessNotificationCreateContract.validate(payload)).toBe(true);
    expect(
      notificationCreateContract.validate({ ...payload, userId: 'bad' }),
    ).toBe(false);
    expect(
      notificationCreateContract.validate({ ...payload, version: 0 }),
    ).toBe(false);
    expect(
      notificationCreateContract.validate({ ...payload, occurredAt: 'bad' }),
    ).toBe(false);
    expect(
      notificationCreateContract.domainIdempotencyKey(payload, jobContext),
    ).toBe(`notification:${payload.type}:${userId}:${occurredAt}`);
    expect(
      accessNotificationCreateContract.domainIdempotencyKey(
        payload,
        jobContext,
      ),
    ).toBe(`access-notification:${payload.type}:${userId}:${occurredAt}`);
  });

  test('AC-6 validates recipient and capability synchronization payloads', () => {
    const recipient = {
      userId,
      displayName: 'Admin',
      email: 'admin@local.app',
      active: true,
      canReadJobs: true,
    };

    expect(notificationRecipientSyncContract.validate(recipient)).toBe(true);
    expect(
      notificationRecipientSyncContract.validate({
        ...recipient,
        active: 'yes',
      }),
    ).toBe(false);
    expect(
      accessNotificationRecipientCapabilitySyncContract.validate({
        userId,
        canReadJobs: false,
      }),
    ).toBe(true);
    expect(
      accessNotificationRecipientCapabilitySyncContract.validate({
        userId,
        canReadJobs: 'false',
      }),
    ).toBe(false);
    expect(
      accessNotificationRecipientCapabilitySyncContract.domainIdempotencyKey(
        { userId, canReadJobs: true },
        jobContext,
      ),
    ).toBe(`recipient-capability:${userId}:true`);
  });

  test('AC-9 and AC-10 validate email and terminal failure payloads', () => {
    expect(
      notificationEmailDeliveryContract.validate({
        notificationDeliveryId: deliveryId,
      }),
    ).toBe(true);
    expect(
      notificationEmailDeliveryContract.validate({
        notificationDeliveryId: 'bad',
      }),
    ).toBe(false);
    expect(
      notificationEmailDeliveryContract.domainIdempotencyKey(
        { notificationDeliveryId: deliveryId },
        jobContext,
      ),
    ).toBe(`email:${deliveryId}`);

    const failure = {
      jobId,
      jobType: 'auth.send_user_invitation',
      attemptCount: 5,
      failedAt: occurredAt,
    };
    expect(jobFailureNotificationContract.validate(failure)).toBe(true);
    expect(
      jobFailureNotificationContract.validate({
        ...failure,
        attemptCount: 1.5,
      }),
    ).toBe(false);
    expect(
      jobFailureNotificationContract.validate({ ...failure, failedAt: 'bad' }),
    ).toBe(false);
    expect(
      jobFailureNotificationContract.domainIdempotencyKey(failure, jobContext),
    ).toBe(`job-failure:${jobId}`);
  });
});
