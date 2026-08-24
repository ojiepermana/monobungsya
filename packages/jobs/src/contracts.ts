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
    terminalFailureNotification: false,
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
    terminalFailureNotification: false,
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
