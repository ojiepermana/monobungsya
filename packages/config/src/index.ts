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
  TELEMETRY_ENABLED: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  TELEMETRY_DATABASE_URL: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().url().optional(),
  ),
  OBSERVABILITY_DATABASE_URL: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().url().optional(),
  ),
  OBSERVABILITY_SIGNAL_WRITE_MODE: z
    .enum(['postgres', 'dual', 'clickhouse'])
    .default('postgres'),
  OBSERVABILITY_SIGNAL_READ_MODE: z
    .enum(['postgres', 'clickhouse'])
    .default('postgres'),
  OBSERVABILITY_SIGNAL_PROMOTION_REPORT_ID: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().uuid().optional(),
  ),
  CLICKHOUSE_URL: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().url().optional(),
  ),
  CLICKHOUSE_WRITER_USERNAME: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().min(1).optional(),
  ),
  CLICKHOUSE_WRITER_PASSWORD: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().min(1).optional(),
  ),
  CLICKHOUSE_READINESS_USERNAME: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().min(1).optional(),
  ),
  CLICKHOUSE_READINESS_PASSWORD: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().min(1).optional(),
  ),
  CLICKHOUSE_READER_USERNAME: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().min(1).optional(),
  ),
  CLICKHOUSE_READER_PASSWORD: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().min(1).optional(),
  ),
  CLICKHOUSE_MIGRATOR_USERNAME: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().min(1).optional(),
  ),
  CLICKHOUSE_MIGRATOR_PASSWORD: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().min(1).optional(),
  ),
  CLICKHOUSE_TLS_CA_FILE: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().min(1).optional(),
  ),
  CLICKHOUSE_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5_000),
  OBSERVABILITY_SIGNAL_QUEUE_MAX_ITEMS: z.coerce
    .number()
    .int()
    .positive()
    .max(20_000)
    .default(20_000),
  OBSERVABILITY_SIGNAL_QUEUE_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(4_096)
    .max(33_554_432)
    .default(33_554_432),
  OBSERVABILITY_SIGNAL_BATCH_MAX_ITEMS: z.coerce
    .number()
    .int()
    .positive()
    .max(5_000)
    .default(5_000),
  OBSERVABILITY_SIGNAL_BATCH_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(4_096)
    .max(4_194_304)
    .default(4_194_304),
  OBSERVABILITY_SIGNAL_FLUSH_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(500)
    .default(500),
  OBSERVABILITY_SIGNAL_MAX_IN_FLIGHT: z.coerce
    .number()
    .int()
    .positive()
    .max(4)
    .default(4),
  OBSERVABILITY_SIGNAL_RETRY_LIMIT: z.coerce
    .number()
    .int()
    .min(0)
    .max(3)
    .default(3),
  OBSERVABILITY_SIGNAL_QUERY_MAX_CONCURRENCY: z.coerce
    .number()
    .int()
    .positive()
    .max(8)
    .default(8),
  OBSERVABILITY_INGESTION_KEYS: z.string().default(''),
  OBSERVABILITY_INGESTION_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5_242_880),
  OBSERVABILITY_INGESTION_CLOCK_SKEW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60),
  OBSERVABILITY_QUERY_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5_000),
  OBSERVABILITY_MAX_SERIES: z.coerce.number().int().positive().default(200),
  OBSERVABILITY_ALERT_RULES_PATH: z
    .string()
    .default('benchmarks/alert-rules.json'),
  OBSERVABILITY_PROFILE_DIR: z.string().default('/tmp/observability-profiles'),
  OBSERVABILITY_PROFILE_MAX_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .max(60)
    .default(60),
  TELEMETRY_QUEUE_CAPACITY: z.coerce.number().int().positive().default(2000),
  TELEMETRY_PRIORITY_CAPACITY: z.coerce.number().int().positive().default(500),
  TELEMETRY_BATCH_SIZE: z.coerce.number().int().positive().default(200),
  TELEMETRY_FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  TELEMETRY_FLUSH_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  TELEMETRY_SUCCESS_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.05),
  TELEMETRY_SLOW_THRESHOLD_MS: z.coerce.number().int().positive().default(1000),
  SERVICE_INSTANCE_ID: z.string().trim().min(1).optional(),
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
  | 'LOG_DATABASE_URL'
  | 'BEST_EFFORT_LOGGING_ENABLED'
  | 'TELEMETRY_DATABASE_URL'
  | 'OBSERVABILITY_DATABASE_URL'
  | 'TELEMETRY_ENABLED'
  | 'SERVICE_INSTANCE_ID'
> & {
  serviceName: string;
  LOG_DATABASE_URL: string;
  BEST_EFFORT_LOGGING_ENABLED: boolean;
  TELEMETRY_DATABASE_URL: string;
  OBSERVABILITY_DATABASE_URL: string;
  TELEMETRY_ENABLED: boolean;
  serviceInstanceId: string;
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
  const telemetryEnabled =
    parsed.TELEMETRY_ENABLED ??
    (parsed.NODE_ENV === 'production' || parsed.ENABLE_INFRASTRUCTURE === true);
  const telemetryDatabaseUrl =
    parsed.TELEMETRY_DATABASE_URL ?? parsed.DATABASE_URL;
  const observabilityDatabaseUrl =
    parsed.OBSERVABILITY_DATABASE_URL ?? telemetryDatabaseUrl;
  const usesClickHouseWriter =
    parsed.OBSERVABILITY_SIGNAL_WRITE_MODE === 'dual' ||
    parsed.OBSERVABILITY_SIGNAL_WRITE_MODE === 'clickhouse';
  const usesClickHouseReader =
    parsed.OBSERVABILITY_SIGNAL_READ_MODE === 'clickhouse';
  const clickHouseUrl = parsed.CLICKHOUSE_URL
    ? new URL(parsed.CLICKHOUSE_URL)
    : undefined;

  if (clickHouseUrl?.username || clickHouseUrl?.password) {
    throw new Error('CLICKHOUSE_URL must not contain username or password');
  }
  if (
    parsed.OBSERVABILITY_SIGNAL_BATCH_MAX_ITEMS >
    parsed.OBSERVABILITY_SIGNAL_QUEUE_MAX_ITEMS
  ) {
    throw new Error(
      'OBSERVABILITY_SIGNAL_BATCH_MAX_ITEMS cannot exceed OBSERVABILITY_SIGNAL_QUEUE_MAX_ITEMS',
    );
  }
  if (
    parsed.OBSERVABILITY_SIGNAL_BATCH_MAX_BYTES >
    parsed.OBSERVABILITY_SIGNAL_QUEUE_MAX_BYTES
  ) {
    throw new Error(
      'OBSERVABILITY_SIGNAL_BATCH_MAX_BYTES cannot exceed OBSERVABILITY_SIGNAL_QUEUE_MAX_BYTES',
    );
  }
  if (parsed.CLICKHOUSE_TLS_CA_FILE && clickHouseUrl?.protocol !== 'https:') {
    throw new Error('CLICKHOUSE_TLS_CA_FILE requires an HTTPS CLICKHOUSE_URL');
  }

  const validStorageMode =
    (parsed.OBSERVABILITY_SIGNAL_WRITE_MODE === 'postgres' &&
      parsed.OBSERVABILITY_SIGNAL_READ_MODE === 'postgres') ||
    (parsed.OBSERVABILITY_SIGNAL_WRITE_MODE === 'dual' &&
      (parsed.OBSERVABILITY_SIGNAL_READ_MODE === 'postgres' ||
        parsed.OBSERVABILITY_SIGNAL_READ_MODE === 'clickhouse')) ||
    (parsed.OBSERVABILITY_SIGNAL_WRITE_MODE === 'clickhouse' &&
      parsed.OBSERVABILITY_SIGNAL_READ_MODE === 'clickhouse');
  if (!validStorageMode) {
    throw new Error(
      `Invalid observability signal storage mode: ${parsed.OBSERVABILITY_SIGNAL_WRITE_MODE}/${parsed.OBSERVABILITY_SIGNAL_READ_MODE}`,
    );
  }

  const requiresProductionPromotionReport =
    parsed.NODE_ENV === 'production' &&
    ((parsed.OBSERVABILITY_SIGNAL_WRITE_MODE === 'dual' &&
      parsed.OBSERVABILITY_SIGNAL_READ_MODE === 'clickhouse') ||
      parsed.OBSERVABILITY_SIGNAL_WRITE_MODE === 'clickhouse');
  if (
    requiresProductionPromotionReport &&
    !parsed.OBSERVABILITY_SIGNAL_PROMOTION_REPORT_ID
  ) {
    throw new Error(
      'OBSERVABILITY_SIGNAL_PROMOTION_REPORT_ID is required for a production ClickHouse Signal cutover',
    );
  }

  const requiresProductionActivation =
    parsed.NODE_ENV === 'production' &&
    !(
      parsed.OBSERVABILITY_SIGNAL_WRITE_MODE === 'postgres' &&
      parsed.OBSERVABILITY_SIGNAL_READ_MODE === 'postgres'
    );
  if (requiresProductionActivation && !parsed.OBSERVABILITY_DATABASE_URL) {
    throw new Error(
      'OBSERVABILITY_DATABASE_URL is required for a production non-baseline Signal mode',
    );
  }

  if (usesClickHouseWriter || usesClickHouseReader) {
    if (!parsed.CLICKHOUSE_URL) {
      throw new Error(
        'CLICKHOUSE_URL is required when ClickHouse Signal storage is enabled',
      );
    }
    if (
      parsed.NODE_ENV === 'production' &&
      clickHouseUrl?.protocol !== 'https:'
    ) {
      throw new Error('CLICKHOUSE_URL must use HTTPS in production');
    }
  }
  if (
    usesClickHouseWriter &&
    (!parsed.CLICKHOUSE_WRITER_USERNAME || !parsed.CLICKHOUSE_WRITER_PASSWORD)
  ) {
    throw new Error(
      'CLICKHOUSE_WRITER_USERNAME and CLICKHOUSE_WRITER_PASSWORD are required for ClickHouse Signal writes',
    );
  }
  if (
    usesClickHouseWriter &&
    (!parsed.CLICKHOUSE_READINESS_USERNAME ||
      !parsed.CLICKHOUSE_READINESS_PASSWORD)
  ) {
    throw new Error(
      'CLICKHOUSE_READINESS_USERNAME and CLICKHOUSE_READINESS_PASSWORD are required for ClickHouse Signal writer readiness',
    );
  }
  if (
    usesClickHouseReader &&
    (!parsed.CLICKHOUSE_READER_USERNAME || !parsed.CLICKHOUSE_READER_PASSWORD)
  ) {
    throw new Error(
      'CLICKHOUSE_READER_USERNAME and CLICKHOUSE_READER_PASSWORD are required for ClickHouse Signal reads',
    );
  }
  if (
    Boolean(parsed.CLICKHOUSE_MIGRATOR_USERNAME) !==
    Boolean(parsed.CLICKHOUSE_MIGRATOR_PASSWORD)
  ) {
    throw new Error(
      'CLICKHOUSE_MIGRATOR_USERNAME and CLICKHOUSE_MIGRATOR_PASSWORD must be configured together',
    );
  }
  const clickHouseIdentities = [
    parsed.CLICKHOUSE_WRITER_USERNAME,
    parsed.CLICKHOUSE_READINESS_USERNAME,
    parsed.CLICKHOUSE_READER_USERNAME,
    parsed.CLICKHOUSE_MIGRATOR_USERNAME,
  ].filter((identity): identity is string => Boolean(identity));
  if (new Set(clickHouseIdentities).size !== clickHouseIdentities.length) {
    throw new Error(
      'ClickHouse writer, readiness, reader, and migrator credentials must use separate identities',
    );
  }

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
    TELEMETRY_DATABASE_URL: telemetryDatabaseUrl,
    OBSERVABILITY_DATABASE_URL: observabilityDatabaseUrl,
    TELEMETRY_ENABLED: telemetryEnabled,
    serviceInstanceId:
      parsed.SERVICE_INSTANCE_ID ?? `${serviceName}-${crypto.randomUUID()}`,
    serviceName,
  };
}

export { environmentSchema };
