import { type AppEnvironment, loadEnv } from '#project/config';

export interface AccessEnvironment extends AppEnvironment {
  ACCESS_PERMISSION_CACHE_TTL_MS: number;
  ACCESS_PERMISSION_CACHE_MAX_ENTRIES: number;
}

export function loadAccessEnv(
  source: Record<string, string | undefined> = Bun.env,
): AccessEnvironment {
  const environment = loadEnv('access', {
    ...source,
    PORT: source.ACCESS_SERVICE_PORT ?? '3104',
  });
  return {
    ...environment,
    ACCESS_PERMISSION_CACHE_TTL_MS: parsePositive(
      source.ACCESS_PERMISSION_CACHE_TTL_MS,
      300_000,
      'ACCESS_PERMISSION_CACHE_TTL_MS',
    ),
    ACCESS_PERMISSION_CACHE_MAX_ENTRIES: parsePositive(
      source.ACCESS_PERMISSION_CACHE_MAX_ENTRIES,
      1_000,
      'ACCESS_PERMISSION_CACHE_MAX_ENTRIES',
    ),
  };
}

function parsePositive(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export const env = loadAccessEnv();
