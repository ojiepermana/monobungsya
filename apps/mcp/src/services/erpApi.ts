import { env } from "../config/env";

const REQUEST_TIMEOUT_MS = 15_000;

export async function erpRequest<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${env.ERP_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.ERP_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

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
