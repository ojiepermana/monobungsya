import { client } from '#project/angular-sdk';

export interface GatewayCorrelation {
  traceId: string;
  clientRoute: string;
}

export class GatewayRequestError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`Gateway request failed with status ${status}`);
    this.name = 'GatewayRequestError';
    this.status = status;
    this.body = body;
  }
}

let configured = false;
let correlationReader: () => GatewayCorrelation | null = () => null;

export function configureGeneratedClient(
  baseUrl: string,
  currentCorrelation: () => GatewayCorrelation | null,
): void {
  client.setConfig({
    baseUrl,
    credentials: 'include',
  });
  correlationReader = currentCorrelation;

  if (configured) return;

  client.interceptors.request.use(async (request) => {
    const correlation = correlationReader();
    if (!correlation) return request;

    request.headers.set('x-correlation-id', correlation.traceId);
    request.headers.set('x-client-route', correlation.clientRoute);
    return request;
  });

  client.interceptors.error.use(async (error, response) => {
    return new GatewayRequestError(response?.status ?? 0, error);
  });

  configured = true;
}

export async function sdkRequest<T>(run: () => Promise<unknown>): Promise<T> {
  const result = await run();
  if (
    result &&
    typeof result === 'object' &&
    'response' in result &&
    'data' in result
  ) {
    return (result as { data: T }).data;
  }
  return result as T;
}
