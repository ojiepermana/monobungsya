import { type AppEnvironment, loadEnv } from "#project/config";

export type GatewayEnvironment = AppEnvironment & {
  INTERNAL_AUTH_SIGNING_SECRET: string;
  AUTH_CLOCK_SKEW_SECONDS: number;
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
  const environment = loadEnv("api-gateway", source);

  return {
    ...environment,
    INTERNAL_AUTH_SIGNING_SECRET: source.INTERNAL_AUTH_SIGNING_SECRET ?? "",
    AUTH_CLOCK_SKEW_SECONDS: parseNumber(
      source.AUTH_CLOCK_SKEW_SECONDS,
      30,
      "AUTH_CLOCK_SKEW_SECONDS",
    ),
    serviceUrls: {
      auth: source.AUTH_SERVICE_URL ?? "http://localhost:3101",
      user: source.USER_SERVICE_URL ?? "http://localhost:3102",
      employee: source.EMPLOYEE_SERVICE_URL ?? "http://localhost:3103",
      payroll: source.PAYROLL_SERVICE_URL ?? "http://localhost:3104",
      reporting: source.REPORTING_SERVICE_URL ?? "http://localhost:3105",
    },
  };
}

function parseNumber(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

export const env = loadGatewayEnv();
