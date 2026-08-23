import { join } from 'node:path';

const DATABASE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
type DatabaseEnvironment = (typeof DATABASE_ENVIRONMENTS)[number];

export interface DatabaseToolConfig {
  migrationUrl: string;
  nodeEnvironment: DatabaseEnvironment;
  databaseTimezone: 'Asia/Jakarta';
  resetAllowed: boolean;
  lockTimeoutMs: number;
  lockPollMs: number;
  migrationsDir: string;
  seedsDir: string;
  accessBootstrapAdminEmails: string;
}

export interface DatabaseToolConfigOverrides {
  migrationsDir?: string;
  seedsDir?: string;
  lockTimeoutMs?: number;
  lockPollMs?: number;
}

export function loadDatabaseToolConfig(
  source: Record<string, string | undefined> = Bun.env,
  overrides: DatabaseToolConfigOverrides = {},
): DatabaseToolConfig {
  const migrationUrl = source.DATABASE_MIGRATION_URL?.trim();

  if (!migrationUrl) {
    throw new Error(
      'DATABASE_MIGRATION_URL is required for database commands; use the migration role connection',
    );
  }

  const nodeEnvironment = source.NODE_ENV ?? 'development';

  if (!DATABASE_ENVIRONMENTS.includes(nodeEnvironment as DatabaseEnvironment)) {
    throw new Error(`invalid NODE_ENV "${nodeEnvironment}"`);
  }

  const databaseTimezone = source.DATABASE_TIMEZONE ?? 'Asia/Jakarta';

  if (databaseTimezone !== 'Asia/Jakarta') {
    throw new Error('DATABASE_TIMEZONE must be Asia/Jakarta');
  }

  return {
    migrationUrl,
    nodeEnvironment: nodeEnvironment as DatabaseEnvironment,
    databaseTimezone,
    resetAllowed: source.DATABASE_RESET_ALLOWED === 'true',
    lockTimeoutMs:
      overrides.lockTimeoutMs ??
      parsePositiveEnvironment(source, 'DATABASE_LOCK_TIMEOUT_MS', 30_000),
    lockPollMs:
      overrides.lockPollMs ??
      parsePositiveEnvironment(source, 'DATABASE_LOCK_POLL_MS', 100),
    migrationsDir:
      overrides.migrationsDir ??
      source.DATABASE_MIGRATIONS_DIR ??
      join(import.meta.dir, '..', 'migrations'),
    seedsDir:
      overrides.seedsDir ??
      source.DATABASE_SEEDS_DIR ??
      join(import.meta.dir, '..', 'seeds'),
    accessBootstrapAdminEmails: source.ACCESS_BOOTSTRAP_ADMIN_EMAILS ?? '',
  };
}

function parsePositiveEnvironment(
  source: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const rawValue = source[name];

  if (rawValue === undefined) {
    return fallback;
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return value;
}
