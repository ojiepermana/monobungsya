import { describe, expect, it } from 'bun:test';
import { loadEnv } from '#project/config';
import { createApp } from '../app';

describe('user service', () => {
  it('exposes health and module status endpoints', async () => {
    const app = createApp(loadEnv('user', { NODE_ENV: 'test', PORT: '3102' }));
    const health = await app.handle(new Request('http://localhost/health'));
    const moduleStatus = await app.handle(
      new Request('http://localhost/internal/users/status'),
    );

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', service: 'user' });
    expect(moduleStatus.status).toBe(200);
    expect(await moduleStatus.json()).toEqual({
      service: 'user',
      status: 'ok',
      module: 'users',
    });
  });
});
