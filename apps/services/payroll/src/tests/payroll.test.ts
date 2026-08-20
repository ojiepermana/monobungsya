import { describe, expect, it } from 'bun:test';
import { loadEnv } from '#project/config';
import { createApp } from '../app';

describe('payroll service', () => {
  it('exposes health and module status endpoints', async () => {
    const app = createApp(
      loadEnv('payroll', { NODE_ENV: 'test', PORT: '3104' }),
    );
    const health = await app.handle(new Request('http://localhost/health'));
    const moduleStatus = await app.handle(
      new Request('http://localhost/internal/payroll/status'),
    );

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', service: 'payroll' });
    expect(moduleStatus.status).toBe(200);
    expect(await moduleStatus.json()).toEqual({
      service: 'payroll',
      status: 'ok',
      module: 'payroll',
    });
  });
});
