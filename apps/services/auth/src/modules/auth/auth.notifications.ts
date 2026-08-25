import type { DatabaseClient } from '#project/database';
import {
  authNotificationCreateContract,
  enqueueJob,
  type JobRegistry,
} from '#project/jobs';

export interface AuthSecurityContext {
  authMethod:
    | 'magic_link'
    | 'passkey'
    | 'totp'
    | 'recovery_code'
    | 'session_cookie';
  browser: string;
  platform: string;
  maskedIp: string;
  correlationId?: string | null;
}

export interface AuthNotificationSink {
  enqueue(
    transaction: DatabaseClient,
    input: {
      userId: string;
      type: string;
      payload: Record<string, unknown>;
      context: AuthSecurityContext;
    },
  ): Promise<void>;
}

export class DurableAuthNotificationSink implements AuthNotificationSink {
  constructor(private readonly jobs: JobRegistry) {}

  async enqueue(
    transaction: DatabaseClient,
    input: {
      userId: string;
      type: string;
      payload: Record<string, unknown>;
      context: AuthSecurityContext;
    },
  ): Promise<void> {
    const occurredAt = new Date().toISOString();
    await enqueueJob(transaction, this.jobs, {
      type: authNotificationCreateContract.type,
      version: authNotificationCreateContract.version,
      payload: {
        userId: input.userId,
        type: input.type,
        version: 1,
        payload: {
          ...input.payload,
          authMethod: input.context.authMethod,
          browser: input.context.browser,
          platform: input.context.platform,
          maskedIp: input.context.maskedIp,
        },
        occurredAt,
        correlationId: input.context.correlationId,
      },
      sourceService: authNotificationCreateContract.sourceService,
      targetService: authNotificationCreateContract.targetService,
      idempotencyKey: `auth-notification:${input.type}:${input.userId}:${occurredAt}`,
      actorUserId: input.userId,
      correlationId: input.context.correlationId,
    });
  }
}

export function securityContextFromRequest(
  request: Request,
  authMethod: AuthSecurityContext['authMethod'],
): AuthSecurityContext {
  const userAgent = request.headers.get('user-agent') ?? '';
  return {
    authMethod,
    browser: normalizeBrowser(userAgent),
    platform: normalizePlatform(userAgent),
    maskedIp: maskIp(
      request.headers.get('x-real-ip') ??
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        'unknown',
    ),
    correlationId:
      request.headers.get('x-correlation-id') ??
      request.headers.get('x-request-id'),
  };
}

function normalizeBrowser(userAgent: string): string {
  if (/edg\//i.test(userAgent)) return 'Edge';
  if (/opr\//i.test(userAgent)) return 'Opera';
  if (/chrome\//i.test(userAgent)) return 'Chrome';
  if (/firefox\//i.test(userAgent)) return 'Firefox';
  if (/safari\//i.test(userAgent)) return 'Safari';
  return 'Peramban lain';
}

function normalizePlatform(userAgent: string): string {
  if (/iphone|ipad|ios/i.test(userAgent)) return 'iOS';
  if (/android/i.test(userAgent)) return 'Android';
  if (/windows/i.test(userAgent)) return 'Windows';
  if (/mac os x|macintosh/i.test(userAgent)) return 'macOS';
  if (/linux/i.test(userAgent)) return 'Linux';
  return 'Platform lain';
}

function maskIp(value: string): string {
  if (value === 'unknown') return 'unknown';
  if (value.includes(':')) {
    const groups = value.split(':').filter(Boolean).slice(0, 4);
    return `${groups.join(':')}::`;
  }
  const octets = value.split('.');
  return octets.length === 4 ? `${octets.slice(0, 3).join('.')}.0` : 'unknown';
}
