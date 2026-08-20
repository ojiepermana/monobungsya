import { describe, expect, it } from 'bun:test';
import { loadEnv } from '#project/config';
import { createApp } from '../app';

describe('employee service', () => {
  it('exposes health and module status endpoints', async () => {
    const app = createApp(
      loadEnv('employee', { NODE_ENV: 'test', PORT: '3103' }),
    );
    const health = await app.handle(new Request('http://localhost/health'));
    const moduleStatus = await app.handle(
      new Request('http://localhost/internal/employees/status'),
    );

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', service: 'employee' });
    expect(moduleStatus.status).toBe(200);
    expect(await moduleStatus.json()).toEqual({
      service: 'employee',
      status: 'ok',
      module: 'employees',
    });
  });
});
