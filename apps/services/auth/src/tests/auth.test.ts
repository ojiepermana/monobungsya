import { describe, expect, it } from 'bun:test';
import { loadEnv } from '#project/config';
import { createApp } from '../app';

describe('auth service', () => {
  it('exposes health and module status endpoints', async () => {
    const app = createApp(loadEnv('auth', { NODE_ENV: 'test', PORT: '3101' }));

    const health = await app.handle(new Request('http://localhost/health'));
    const moduleStatus = await app.handle(
      new Request('http://localhost/internal/auth/status'),
    );

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', service: 'auth' });
    expect(moduleStatus.status).toBe(200);
    expect(await moduleStatus.json()).toEqual({
      service: 'auth',
      status: 'ok',
      module: 'auth',
    });
  });
});
