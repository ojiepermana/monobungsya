import { Elysia } from 'elysia';
import { ServiceUnavailableError, toErrorResponse } from '#project/errors';
import type { GatewayEnvironment } from '../config/env';

async function forwardRequest(
  request: Request,
  serviceUrl: string,
  publicPrefix: string,
  internalPrefix: string,
): Promise<Response> {
  const incomingUrl = new URL(request.url);
  const suffix = incomingUrl.pathname.slice(publicPrefix.length);
  const upstreamUrl = new URL(
    `${internalPrefix}${suffix}${incomingUrl.search}`,
    serviceUrl,
  );
  const headers = new Headers(request.headers);
  headers.set(
    'x-request-id',
    request.headers.get('x-request-id') ?? crypto.randomUUID(),
  );
  headers.set(
    'x-correlation-id',
    request.headers.get('x-correlation-id') ??
      headers.get('x-request-id') ??
      '',
  );

  try {
    return await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body:
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : await request.arrayBuffer(),
    });
  } catch {
    const mapped = toErrorResponse(
      new ServiceUnavailableError(
        'The requested internal service is unavailable',
      ),
      headers.get('x-request-id') ?? undefined,
    );

    return Response.json(mapped.body, {
      status: mapped.status,
      headers: { 'x-request-id': headers.get('x-request-id') ?? '' },
    });
  }
}

export function createProxyRoute(environment: GatewayEnvironment) {
  return new Elysia({ name: 'gateway-proxy-routes' })
    .get(
      '/api/v1/auth/status',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          '/api/v1/auth',
          '/internal/auth',
        ),
      { detail: { tags: ['Auth'], summary: 'Forward auth status request' } },
    )
    .get(
      '/api/v1/users/status',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.user,
          '/api/v1/users',
          '/internal/users',
        ),
      { detail: { tags: ['Users'], summary: 'Forward users status request' } },
    )
    .get(
      '/api/v1/employees/status',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.employee,
          '/api/v1/employees',
          '/internal/employees',
        ),
      {
        detail: {
          tags: ['Employees'],
          summary: 'Forward employees status request',
        },
      },
    )
    .get(
      '/api/v1/payroll/status',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.payroll,
          '/api/v1/payroll',
          '/internal/payroll',
        ),
      {
        detail: {
          tags: ['Payroll'],
          summary: 'Forward payroll status request',
        },
      },
    )
    .get(
      '/api/v1/reports/status',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.reporting,
          '/api/v1/reports',
          '/internal/reports',
        ),
      {
        detail: {
          tags: ['Reports'],
          summary: 'Forward reports status request',
        },
      },
    )
    .all(
      '/api/v1/auth/*',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          '/api/v1/auth',
          '/internal/auth',
        ),
      {
        detail: { hide: true },
      },
    )
    .all(
      '/api/v1/users/*',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.user,
          '/api/v1/users',
          '/internal/users',
        ),
      {
        detail: { hide: true },
      },
    )
    .all(
      '/api/v1/employees/*',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.employee,
          '/api/v1/employees',
          '/internal/employees',
        ),
      { detail: { hide: true } },
    )
    .all(
      '/api/v1/payroll/*',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.payroll,
          '/api/v1/payroll',
          '/internal/payroll',
        ),
      {
        detail: { hide: true },
      },
    )
    .all(
      '/api/v1/reports/*',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.reporting,
          '/api/v1/reports',
          '/internal/reports',
        ),
      { detail: { hide: true } },
    );
}
