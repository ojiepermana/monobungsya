import { type AppEnvironment, loadEnv } from "#project/config";

export interface AuthEnvironment extends AppEnvironment {
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USERNAME: string;
  SMTP_PASSWORD: string;
  SMTP_FROM: string;
  PUBLIC_API_URL: string;
  WEB_APP_URL: string;
  INTERNAL_AUTH_SIGNING_SECRET: string;
  AUTH_SESSION_COOKIE_NAME: string;
  AUTH_COOKIE_SECURE: boolean;
  AUTH_CLOCK_SKEW_SECONDS: number;
}

export function loadAuthEnv(
  source: Record<string, string | undefined> = Bun.env,
): AuthEnvironment {
  const environment = loadEnv("auth", source);
  const result: AuthEnvironment = {
    ...environment,
    SMTP_HOST: source.SMTP_HOST ?? "127.0.0.1",
    SMTP_PORT: parseNumber(source.SMTP_PORT, 2525, "SMTP_PORT"),
    SMTP_USERNAME: source.SMTP_USERNAME ?? "monobungsia",
    SMTP_PASSWORD: source.SMTP_PASSWORD ?? "",
    SMTP_FROM: source.SMTP_FROM ?? "no-reply@localhost",
    PUBLIC_API_URL: source.PUBLIC_API_URL ?? "http://localhost:3000",
    WEB_APP_URL: source.WEB_APP_URL ?? "http://localhost:4200",
    INTERNAL_AUTH_SIGNING_SECRET: source.INTERNAL_AUTH_SIGNING_SECRET ?? "",
    AUTH_SESSION_COOKIE_NAME:
      source.AUTH_SESSION_COOKIE_NAME ?? "project_session",
    AUTH_COOKIE_SECURE:
      source.AUTH_COOKIE_SECURE === undefined
        ? environment.NODE_ENV === "production"
        : source.AUTH_COOKIE_SECURE === "true",
    AUTH_CLOCK_SKEW_SECONDS: parseNumber(
      source.AUTH_CLOCK_SKEW_SECONDS,
      30,
      "AUTH_CLOCK_SKEW_SECONDS",
    ),
  };

  if (
    (environment.ENABLE_INFRASTRUCTURE ||
      environment.NODE_ENV === "production") &&
    (!result.SMTP_USERNAME ||
      (environment.NODE_ENV === "production" && !result.SMTP_PASSWORD) ||
      !result.INTERNAL_AUTH_SIGNING_SECRET)
  ) {
    throw new Error(
      "SMTP_USERNAME and INTERNAL_AUTH_SIGNING_SECRET are required when auth infrastructure is enabled; SMTP_PASSWORD is also required in production",
    );
  }

  return result;
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

export const env = loadAuthEnv();
export { loadEnv };
