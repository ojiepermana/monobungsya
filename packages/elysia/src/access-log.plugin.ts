import { Elysia } from 'elysia';
import type {
  AccessMetadataV1,
  ActivityActor,
  AuthSessionDetail,
} from '#project/logger';
import { ActivityLog } from '#project/logger';
import {
  normalizeClientCorrelation,
  normalizeClientRoute,
  type TraceSource,
} from './request-id.plugin';
import { getTelemetryContext } from './telemetry.plugin';

export interface AccessLogContext {
  startedAt: number;
  requestId: string | null;
  traceId: string | null;
  traceSource: TraceSource;
  clientRoute: string | null;
  routeName: string | null;
  requiredPermission: string | null;
  actor: ActivityActor | null;
  sessionId: string | null;
  authenticationMethod: string | null;
  failureReason: string | null;
  details: AuthSessionDetail | null;
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
      const requestId =
        lifecycleContext.requestId ??
        lifecycleContext.request.headers.get('x-request-id') ??
        crypto.randomUUID();
      const correlation = normalizeClientCorrelation(
        lifecycleContext.request.headers.get('x-correlation-id'),
        requestId,
      );
      const accessContext: AccessLogContext = {
        startedAt: performance.now(),
        requestId,
        traceId: correlation.value,
        traceSource: correlation.source,
        clientRoute: normalizeClientRoute(
          lifecycleContext.request.headers.get('x-client-route'),
        ),
        routeName: null,
        requiredPermission: null,
        actor: null,
        sessionId: null,
        authenticationMethod: null,
        failureReason: null,
        details: null,
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
      const runtimeContext = getTelemetryContext(request);
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
        runtimeTraceId: runtimeContext?.traceId,
        runtimeSpanId: runtimeContext?.spanId,
        path,
        routeName,
        method: request.method,
        httpStatus: status,
        userAgent: request.headers.get('user-agent'),
        ipAddress: request.headers.get('x-real-ip'),
        forwardedIp: request.headers.get('x-forwarded-for'),
        failureReason: context?.failureReason ?? failureReasonForStatus(status),
        metadata: {
          schemaVersion: 1,
          durationMs: Math.max(
            0,
            Math.round(
              performance.now() - (context?.startedAt ?? performance.now()),
            ),
          ),
          requiredPermission: context?.requiredPermission ?? null,
          correlationSource: context?.traceSource ?? 'request_id',
          client: context?.clientRoute
            ? { route: context.clientRoute, source: 'client_header' }
            : null,
          details: context?.details ?? null,
        } satisfies AccessMetadataV1,
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
