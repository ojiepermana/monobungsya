import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgres://postgres:postgres@localhost:5432/project'),
  NATS_URL: z.string().url().default('nats://localhost:4222'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_DATABASE_URL: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().url().optional(),
  ),
  BEST_EFFORT_LOGGING_ENABLED: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  LOG_FLUSH_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  ENABLE_INFRASTRUCTURE: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  DURABLE_JOBS_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  CORS_ORIGIN: z.string().default('http://localhost:4200'),
  INTERNAL_AUTH_SIGNING_SECRET: z.string().default(''),
  AUTH_CLOCK_SKEW_SECONDS: z.coerce.number().int().positive().default(30),
});

export type AppEnvironment = Omit<
  z.infer<typeof environmentSchema>,
  'LOG_DATABASE_URL' | 'BEST_EFFORT_LOGGING_ENABLED'
> & {
  serviceName: string;
  LOG_DATABASE_URL: string;
  BEST_EFFORT_LOGGING_ENABLED: boolean;
};

type EnvironmentSource = Record<string, string | undefined>;

export function loadEnv(
  serviceName: string,
  source: EnvironmentSource = Bun.env,
): AppEnvironment {
  const parsed = environmentSchema.parse(source);
  const logDatabaseUrl =
    parsed.LOG_DATABASE_URL ??
    (parsed.NODE_ENV === 'production' ? '' : parsed.DATABASE_URL);
  const bestEffortLogging =
    parsed.BEST_EFFORT_LOGGING_ENABLED ?? parsed.ENABLE_INFRASTRUCTURE === true;

  if (parsed.NODE_ENV === 'production' && !parsed.LOG_DATABASE_URL) {
    throw new Error(
      'LOG_DATABASE_URL is required in production so log writers use the least privilege connection',
    );
  }

  if (
    (parsed.NODE_ENV === 'production' ||
      parsed.ENABLE_INFRASTRUCTURE === true) &&
    parsed.INTERNAL_AUTH_SIGNING_SECRET === ''
  ) {
    throw new Error(
      'INTERNAL_AUTH_SIGNING_SECRET is required when infrastructure is enabled or NODE_ENV is production',
    );
  }

  return {
    ...parsed,
    ENABLE_INFRASTRUCTURE: parsed.ENABLE_INFRASTRUCTURE ?? false,
    DURABLE_JOBS_ENABLED: parsed.DURABLE_JOBS_ENABLED ?? false,
    LOG_DATABASE_URL: logDatabaseUrl,
    BEST_EFFORT_LOGGING_ENABLED: bestEffortLogging,
    serviceName,
  };
}

export { environmentSchema };
