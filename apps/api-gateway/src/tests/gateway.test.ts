import { describe, expect, it } from 'bun:test';
import { createApp } from '../app';
import { loadGatewayEnv } from '../config/env';

describe('api gateway', () => {
  it('exposes health and forwards public boundaries', async () => {
    const app = createApp(loadGatewayEnv({ NODE_ENV: 'test', PORT: '3000' }));
    const health = await app.handle(new Request('http://localhost/health'));
    const unavailableService = await app.handle(
      new Request('http://localhost/api/v1/users/status'),
    );

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      status: 'ok',
      service: 'api-gateway',
    });
    expect(unavailableService.status).toBe(503);
    expect(await unavailableService.json()).toMatchObject({
      error: { code: 'SERVICE_UNAVAILABLE' },
    });
  });
});
