import { Elysia } from 'elysia';
import { type ActivityActor, ActivityLog } from '#project/logger';

export interface AccessLogContext {
  startedAt: number;
  requestId: string | null;
  traceId: string | null;
  routeName: string | null;
  capability: string | null;
  actor: ActivityActor | null;
  sessionId: string | null;
  authenticationMethod: string | null;
  failureReason: string | null;
}

const contexts = new WeakMap<Request, AccessLogContext>();

export function updateAccessLogContext(
  request: Request,
  update: Partial<AccessLogContext>,
): void {
  const current = contexts.get(request);
  if (current) {
    Object.assign(current, update);
  }
}

export function createAccessLogPlugin() {
  return new Elysia({ name: 'gateway-access-log' })
    .derive({ as: 'global' }, (context) => {
      const lifecycleContext = context as typeof context & {
        requestId?: string;
        correlationId?: string;
      };
      const accessContext: AccessLogContext = {
        startedAt: performance.now(),
        requestId:
          lifecycleContext.requestId ??
          lifecycleContext.request.headers.get('x-request-id'),
        traceId:
          lifecycleContext.correlationId ??
          lifecycleContext.request.headers.get('x-correlation-id') ??
          lifecycleContext.request.headers.get('x-request-id'),
        routeName: null,
        capability: null,
        actor: null,
        sessionId: null,
        authenticationMethod: null,
        failureReason: null,
      };
      contexts.set(lifecycleContext.request, accessContext);
      return { accessLogContext: accessContext };
    })
    .onAfterResponse({ as: 'global' }, ({ request, responseValue, set }) => {
      const path = new URL(request.url).pathname;
      if (!path.startsWith('/api/v1/') || request.method === 'OPTIONS') {
        contexts.delete(request);
        return;
      }

      const context = contexts.get(request);
      const status = responseStatus(responseValue, set.status);
      const routeName = context?.routeName ?? normalizeRouteName(path);

      ActivityLog.writeAccess({
        event:
          status === 401
            ? 'authentication_required'
            : status === 403
              ? 'permission_denied'
              : 'api_request',
        outcome: status < 400 ? 'success' : 'failure',
        authenticationMethod: context?.authenticationMethod,
        accessChannel: 'api',
        guard: 'gateway',
        actor: context?.actor,
        sessionId: context?.sessionId,
        requestId: context?.requestId,
        traceId: context?.traceId,
        path,
        routeName,
        method: request.method,
        httpStatus: status,
        userAgent: request.headers.get('user-agent'),
        ipAddress: request.headers.get('x-real-ip'),
        forwardedIp: request.headers.get('x-forwarded-for'),
        failureReason: context?.failureReason ?? failureReasonForStatus(status),
        metadata: {
          durationMs: Math.max(
            0,
            Math.round(
              performance.now() - (context?.startedAt ?? performance.now()),
            ),
          ),
          capability: context?.capability,
        },
      });
      contexts.delete(request);
    });
}

function responseStatus(value: unknown, configuredStatus: unknown): number {
  if (value instanceof Response) return value.status;
  if (typeof configuredStatus === 'number') return configuredStatus;
  return 200;
}

function normalizeRouteName(path: string): string {
  return path.replace(
    /\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?=\/|$)/gi,
    '/:id',
  );
}

function failureReasonForStatus(status: number): string | null {
  if (status === 401) return 'authentication_required';
  if (status === 403) return 'permission_denied';
  return status >= 400 ? `http_${status}` : null;
}
