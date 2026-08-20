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
  ENABLE_INFRASTRUCTURE: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  CORS_ORIGIN: z.string().default('http://localhost:4200'),
});

export type AppEnvironment = z.infer<typeof environmentSchema> & {
  serviceName: string;
};

type EnvironmentSource = Record<string, string | undefined>;

export function loadEnv(
  serviceName: string,
  source: EnvironmentSource = Bun.env,
): AppEnvironment {
  const parsed = environmentSchema.parse(source);

  return {
    ...parsed,
    ENABLE_INFRASTRUCTURE: parsed.ENABLE_INFRASTRUCTURE ?? false,
    serviceName,
  };
}

export { environmentSchema };
