import { Elysia } from 'elysia';

export type TraceSource = 'client_header' | 'request_id';

const CLIENT_CORRELATION_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;

export function normalizeClientCorrelation(
  value: string | null,
  requestId: string,
): { value: string; source: TraceSource } {
  return value && CLIENT_CORRELATION_PATTERN.test(value)
    ? { value, source: 'client_header' }
    : { value: requestId, source: 'request_id' };
}

export function normalizeClientRoute(value: string | null): string | null {
  if (!value?.startsWith('/')) return null;

  try {
    const pathname = new URL(value, 'http://localhost').pathname;
    if (pathname.length > 255) return null;
    return normalizeUuidSegments(pathname);
  } catch {
    return null;
  }
}

function normalizeUuidSegments(path: string): string {
  return path.replace(
    /\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?=\/|$)/gi,
    '/:id',
  );
}

export const requestIdPlugin = new Elysia({ name: 'request-id' }).derive(
  ({ request, set }) => {
    const requestId =
      request.headers.get('x-request-id') ?? crypto.randomUUID();
    const correlation = normalizeClientCorrelation(
      request.headers.get('x-correlation-id'),
      requestId,
    );
    set.headers['x-request-id'] = requestId;
    return {
      requestId,
      correlationId: correlation.value,
      traceSource: correlation.source,
      clientRoute: normalizeClientRoute(request.headers.get('x-client-route')),
    };
  },
);
