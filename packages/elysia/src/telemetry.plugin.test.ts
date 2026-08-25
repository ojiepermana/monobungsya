import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { TelemetryRuntime } from '#project/telemetry';
import { requestIdPlugin } from './request-id.plugin';
import { createTelemetryPlugin, getTelemetryContext } from './telemetry.plugin';

describe('runtime telemetry plugin', () => {
  test('starts a W3C trace and exposes a response traceparent', async () => {
    const runtime = new TelemetryRuntime({
      serviceName: 'test-service',
      serviceInstanceId: 'test-instance',
      successSampleRate: 1,
    });
    const app = new Elysia()
      .use(requestIdPlugin)
      .use(createTelemetryPlugin(runtime))
      .get('/health', ({ request }) => {
        const context = getTelemetryContext(request);
        const ambient = runtime.currentContext();
        return {
          runtimeTraceId: context?.traceId,
          runtimeSpanId: context?.spanId,
          ambientTraceId: ambient?.traceId,
        };
      });

    const response = await app.handle(
      new Request('http://localhost/health', {
        headers: {
          'x-request-id': 'request-1',
          'x-correlation-id': 'journey-1',
        },
      }),
    );
    const body = (await response.json()) as {
      runtimeTraceId: string;
      runtimeSpanId: string;
      ambientTraceId: string;
    };
    expect(response.status).toBe(200);
    expect(body.runtimeTraceId).toMatch(/^[0-9a-f]{32}$/);
    expect(body.runtimeSpanId).toMatch(/^[0-9a-f]{16}$/);
    expect(body.ambientTraceId).toBe(body.runtimeTraceId);
    expect(response.headers.get('traceparent')).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/,
    );
  });
});
