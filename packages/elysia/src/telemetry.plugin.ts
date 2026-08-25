import { Elysia } from 'elysia';
import type {
  SpanHandle,
  Telemetry,
  TelemetryContext,
} from '#project/telemetry';
import { isValidTraceparent } from '#project/telemetry';

interface ActiveRequest {
  handle: SpanHandle;
  context: TelemetryContext;
}

const activeRequests = new WeakMap<Request, ActiveRequest>();

function responseStatus(value: unknown, configuredStatus: unknown): number {
  if (value instanceof Response) return value.status;
  if (typeof configuredStatus === 'number') return configuredStatus;
  return 200;
}

function routeName(request: Request): string {
  return new URL(request.url).pathname
    .replace(
      /\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?=\/|$)/gi,
      '/:id',
    )
    .slice(0, 150);
}

export function getTelemetryContext(
  request: Request,
): TelemetryContext | undefined {
  return activeRequests.get(request)?.context;
}

export function createTelemetryPlugin(telemetry?: Telemetry) {
  const plugin = new Elysia({ name: 'runtime-telemetry' });
  if (!telemetry) return plugin;

  return plugin
    .derive({ as: 'global' }, ({ request, set }) => {
      const requestId = request.headers.get('x-request-id');
      const correlationId = request.headers.get('x-correlation-id');
      const incomingTraceparent = request.headers.get('traceparent');
      const extracted = telemetry.extract({ traceparent: incomingTraceparent });
      const parent =
        incomingTraceparent && isValidTraceparent(incomingTraceparent)
          ? extracted
          : null;
      const handle = telemetry.startSpan(
        {
          resourceKind: 'http.server',
          resourceName: routeName(request),
          operation: request.method,
          attributes: { http_method: request.method },
        },
        { parent, correlationId, requestId },
      );
      const context = handle.context;
      activeRequests.set(request, { handle, context });
      set.headers.traceparent = telemetry.inject(context).traceparent ?? '';
      return { runtimeTraceId: context.traceId, runtimeSpanId: context.spanId };
    })
    .onBeforeHandle({ as: 'global' }, ({ request }) => {
      const active = activeRequests.get(request);
      if (active) telemetry.enterContext(active.context);
    })
    .onAfterResponse({ as: 'global' }, ({ request, responseValue, set }) => {
      const active = activeRequests.get(request);
      if (!active) return;
      const statusCode = responseStatus(responseValue, set.status);
      active.handle.end({
        status: statusCode >= 400 ? 'error' : 'ok',
        statusCode,
        attributes: { http_status_code: statusCode },
      });
      activeRequests.delete(request);
    })
    .onError({ as: 'global' }, ({ request, error }) => {
      const active = activeRequests.get(request);
      if (!active) return;
      active.handle.end({ status: 'error', error });
    });
}
