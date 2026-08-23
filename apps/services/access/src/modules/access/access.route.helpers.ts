import type { AuthIdentity } from '#project/contracts';
import type { AccessActor, AccessCorrelation } from './access.types';

export function actorFromIdentity(identity: AuthIdentity): AccessActor {
  return { id: identity.userId, email: identity.email };
}

export function accessCorrelation(request: Request): AccessCorrelation {
  return {
    requestId: request.headers.get('x-request-id'),
    ipAddress:
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: request.headers.get('user-agent'),
  };
}
