import type { JobContract } from './index';

export interface AuthSendUserInvitationPayload {
  userId: string;
}

export type AuthCleanupExpiredSecurityDataPayload = Record<string, never>;

const isObject = (payload: unknown): payload is Record<string, unknown> =>
  typeof payload === 'object' && payload !== null && !Array.isArray(payload);

export const authSendUserInvitationContract: JobContract<AuthSendUserInvitationPayload> =
  {
    type: 'auth.send_user_invitation',
    version: 1,
    sourceService: 'user',
    targetService: 'auth',
    validate: (payload): payload is AuthSendUserInvitationPayload =>
      isObject(payload) && typeof payload.userId === 'string',
    domainIdempotencyKey: (payload) => `user-invitation:${payload.userId}`,
    operatorPayloadKeys: ['userId'],
    maxAttempts: 5,
    terminalFailureNotification: true,
  };

export const authCleanupExpiredSecurityDataContract: JobContract<AuthCleanupExpiredSecurityDataPayload> =
  {
    type: 'auth.cleanup_expired_security_data',
    version: 1,
    sourceService: 'jobs',
    targetService: 'auth',
    validate: (payload): payload is AuthCleanupExpiredSecurityDataPayload =>
      isObject(payload) && Object.keys(payload).length === 0,
    domainIdempotencyKey: () => 'auth-cleanup-expired-security-data',
    operatorPayloadKeys: [],
    maxAttempts: 3,
    terminalFailureNotification: true,
    schedules: [
      {
        code: 'auth.cleanup_expired_security_data',
        cronExpression: '0 3 * * *',
        timezone: 'Asia/Jakarta',
        enabled: true,
      },
    ],
  };

export const AUTH_JOB_CONTRACTS = [
  authSendUserInvitationContract,
  authCleanupExpiredSecurityDataContract,
] as const;

export interface NotificationCreatePayload {
  userId: string;
  type: string;
  version: number;
  payload: Record<string, unknown>;
  occurredAt: string;
  correlationId?: string | null;
  eventKey?: string;
}

export interface NotificationRecipientSyncPayload {
  userId: string;
  displayName: string;
  email: string;
  active: boolean;
  canReadJobs?: boolean;
}

export interface NotificationRecipientCapabilitySyncPayload {
  userId: string;
  canReadJobs: boolean;
}

export interface NotificationEmailDeliveryPayload {
  notificationDeliveryId: string;
}

export interface JobFailureNotificationPayload {
  jobId: string;
  jobType: string;
  attemptCount: number;
  failedAt: string;
}

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const isDateString = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));

const isNotificationCreatePayload = (
  payload: unknown,
): payload is NotificationCreatePayload => {
  if (!isObject(payload)) return false;
  return (
    isUuid(payload.userId) &&
    typeof payload.type === 'string' &&
    payload.type.length > 0 &&
    typeof payload.version === 'number' &&
    Number.isInteger(payload.version) &&
    payload.version > 0 &&
    isObject(payload.payload) &&
    isDateString(payload.occurredAt) &&
    (payload.correlationId === undefined ||
      payload.correlationId === null ||
      typeof payload.correlationId === 'string') &&
    (payload.eventKey === undefined || typeof payload.eventKey === 'string')
  );
};

const isNotificationRecipientSyncPayload = (
  payload: unknown,
): payload is NotificationRecipientSyncPayload => {
  if (!isObject(payload)) return false;
  return (
    isUuid(payload.userId) &&
    typeof payload.displayName === 'string' &&
    typeof payload.email === 'string' &&
    typeof payload.active === 'boolean' &&
    (payload.canReadJobs === undefined ||
      typeof payload.canReadJobs === 'boolean')
  );
};

const isNotificationEmailDeliveryPayload = (
  payload: unknown,
): payload is NotificationEmailDeliveryPayload =>
  isObject(payload) && isUuid(payload.notificationDeliveryId);

const isNotificationRecipientCapabilitySyncPayload = (
  payload: unknown,
): payload is NotificationRecipientCapabilitySyncPayload =>
  isObject(payload) &&
  isUuid(payload.userId) &&
  typeof payload.canReadJobs === 'boolean';

export const notificationCreateContract: JobContract<NotificationCreatePayload> =
  {
    type: 'notification.create',
    version: 1,
    sourceService: 'user',
    targetService: 'notification',
    validate: isNotificationCreatePayload,
    domainIdempotencyKey: (payload) =>
      `notification:${payload.type}:${payload.userId}:${payload.occurredAt}`,
    operatorPayloadKeys: ['userId', 'type', 'version'],
    maxAttempts: 5,
    terminalFailureNotification: false,
  };

export const authNotificationCreateContract: JobContract<NotificationCreatePayload> =
  {
    type: 'auth.notification.create',
    version: 1,
    sourceService: 'auth',
    targetService: 'notification',
    validate: isNotificationCreatePayload,
    domainIdempotencyKey: (payload) =>
      `auth-notification:${payload.type}:${payload.userId}:${payload.occurredAt}`,
    operatorPayloadKeys: ['userId', 'type', 'version'],
    maxAttempts: 5,
    terminalFailureNotification: false,
  };

export const accessNotificationCreateContract: JobContract<NotificationCreatePayload> =
  {
    type: 'access.notification.create',
    version: 1,
    sourceService: 'access',
    targetService: 'notification',
    validate: isNotificationCreatePayload,
    domainIdempotencyKey: (payload) =>
      `access-notification:${payload.type}:${payload.userId}:${payload.occurredAt}`,
    operatorPayloadKeys: ['userId', 'type', 'version'],
    maxAttempts: 5,
    terminalFailureNotification: false,
  };

export const notificationRecipientSyncContract: JobContract<NotificationRecipientSyncPayload> =
  {
    type: 'notification.recipient_sync',
    version: 1,
    sourceService: 'user',
    targetService: 'notification',
    validate: isNotificationRecipientSyncPayload,
    domainIdempotencyKey: (payload) => `recipient:${payload.userId}`,
    operatorPayloadKeys: ['userId', 'active'],
    maxAttempts: 5,
    terminalFailureNotification: false,
  };

export const accessNotificationRecipientCapabilitySyncContract: JobContract<NotificationRecipientCapabilitySyncPayload> =
  {
    type: 'access.notification.recipient_capability_sync',
    version: 1,
    sourceService: 'access',
    targetService: 'notification',
    validate: isNotificationRecipientCapabilitySyncPayload,
    domainIdempotencyKey: (payload) =>
      `recipient-capability:${payload.userId}:${payload.canReadJobs}`,
    operatorPayloadKeys: ['userId', 'canReadJobs'],
    maxAttempts: 5,
    terminalFailureNotification: false,
  };

export const notificationEmailDeliveryContract: JobContract<NotificationEmailDeliveryPayload> =
  {
    type: 'notification.email_delivery',
    version: 1,
    sourceService: 'notification',
    targetService: 'notification',
    validate: isNotificationEmailDeliveryPayload,
    domainIdempotencyKey: (payload) =>
      `email:${payload.notificationDeliveryId}`,
    operatorPayloadKeys: ['notificationDeliveryId'],
    maxAttempts: 5,
    terminalFailureNotification: false,
  };

export const jobFailureNotificationContract: JobContract<JobFailureNotificationPayload> =
  {
    type: 'jobs.notify_job_failure',
    version: 1,
    sourceService: 'auth',
    targetService: 'notification',
    validate: (payload): payload is JobFailureNotificationPayload =>
      isObject(payload) &&
      isUuid(payload.jobId) &&
      typeof payload.jobType === 'string' &&
      typeof payload.attemptCount === 'number' &&
      Number.isInteger(payload.attemptCount) &&
      isDateString(payload.failedAt),
    domainIdempotencyKey: (payload) => `job-failure:${payload.jobId}`,
    operatorPayloadKeys: ['jobId', 'jobType', 'attemptCount'],
    maxAttempts: 5,
    terminalFailureNotification: false,
  };

export const NOTIFICATION_JOB_CONTRACTS = [
  notificationCreateContract,
  authNotificationCreateContract,
  accessNotificationCreateContract,
  notificationRecipientSyncContract,
  accessNotificationRecipientCapabilitySyncContract,
  notificationEmailDeliveryContract,
  jobFailureNotificationContract,
] as const;
