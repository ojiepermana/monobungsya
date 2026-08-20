import { type AppEnvironment, loadEnv } from '#project/config';

export type GatewayEnvironment = AppEnvironment & {
  serviceUrls: {
    auth: string;
    user: string;
    employee: string;
    payroll: string;
    reporting: string;
  };
};

export function loadGatewayEnv(
  source: Record<string, string | undefined> = Bun.env,
): GatewayEnvironment {
  const environment = loadEnv('api-gateway', source);

  return {
    ...environment,
    serviceUrls: {
      auth: source.AUTH_SERVICE_URL ?? 'http://localhost:3101',
      user: source.USER_SERVICE_URL ?? 'http://localhost:3102',
      employee: source.EMPLOYEE_SERVICE_URL ?? 'http://localhost:3103',
      payroll: source.PAYROLL_SERVICE_URL ?? 'http://localhost:3104',
      reporting: source.REPORTING_SERVICE_URL ?? 'http://localhost:3105',
    },
  };
}

export const env = loadGatewayEnv();
