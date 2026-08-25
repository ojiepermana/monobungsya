import { TelemetryRuntime } from '#project/telemetry';

export const telemetry =
  Bun.env.TELEMETRY_ENABLED === 'true'
    ? new TelemetryRuntime({
        serviceName: 'mcp',
        serviceInstanceId: Bun.env.SERVICE_INSTANCE_ID ?? `mcp-${process.pid}`,
        enabled: true,
      })
    : undefined;
