import { env } from '../config/env';
import { telemetry } from './telemetry';

const REQUEST_TIMEOUT_MS = 15_000;

export async function erpRequest<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${env.ERP_TOKEN}`);
  headers.set('Content-Type', 'application/json');

  const request = () =>
    fetch(`${env.ERP_URL}${path}`, {
      ...options,
      headers,
      signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  const response = telemetry
    ? await telemetry.withSpan(
        {
          resourceKind: 'http.client',
          resourceName: 'erp.stock',
          operation: options.method ?? 'GET',
        },
        request,
      )
    : await request();

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `ERP request failed: ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
    );
  }

  return (await response.json()) as T;
}

export function getStock(sku: string): Promise<unknown> {
  return erpRequest(`/api/v1/stock?sku=${encodeURIComponent(sku)}`);
}
