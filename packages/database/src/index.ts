import { SQL } from 'bun';

export type DatabaseClient = SQL;

export interface DatabaseTelemetry {
  withSpan<T>(
    definition: {
      resourceKind: 'db.query';
      resourceName: string;
      operation: string;
    },
    action: () => T,
  ): T;
  withSpan<T>(
    definition: {
      resourceKind: 'db.query';
      resourceName: string;
      operation: string;
    },
    action: () => Promise<T>,
  ): Promise<T>;
}

export function createDatabaseClient(connectionString: string): DatabaseClient {
  const configuredMax = Number(Bun.env.DATABASE_POOL_MAX ?? 2);
  if (
    !Number.isInteger(configuredMax) ||
    configuredMax < 1 ||
    configuredMax > 50
  ) {
    throw new Error('DATABASE_POOL_MAX must be an integer between 1 and 50');
  }
  return new SQL(connectionString, {
    max: configuredMax,
    connectionTimeout: 10,
  });
}

/**
 * Adds the database boundary to application queries without importing the
 * telemetry package into the database package. The callback shape keeps the
 * package dependency graph one way while allowing every repository to use the
 * same typed seam.
 */
export function createTelemetryDatabaseClient(
  database: DatabaseClient,
  telemetry: DatabaseTelemetry,
  resourceName: string,
): DatabaseClient {
  const wrap = (value: unknown): unknown => {
    if (typeof value !== 'function' || value === database) return value;
    const functionValue = value as (...args: never[]) => unknown;
    return new Proxy(functionValue, {
      apply(target, thisArg, argumentsList) {
        return telemetry.withSpan(
          {
            resourceKind: 'db.query',
            resourceName,
            operation: 'query',
          },
          () => Reflect.apply(target, thisArg, argumentsList),
        );
      },
    });
  };

  const wrapClient = (client: unknown): DatabaseClient =>
    new Proxy(client as DatabaseClient, {
      apply(target, thisArg, argumentsList) {
        return telemetry.withSpan(
          {
            resourceKind: 'db.query',
            resourceName,
            operation: 'query',
          },
          () => Reflect.apply(target, thisArg, argumentsList),
        );
      },
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property === 'begin' && typeof value === 'function') {
          return (...argumentsList: unknown[]) => {
            const callback = argumentsList[0];
            if (typeof callback !== 'function') {
              return Reflect.apply(value, target, argumentsList as never[]);
            }
            return telemetry.withSpan(
              {
                resourceKind: 'db.query',
                resourceName,
                operation: 'transaction',
              },
              () =>
                Reflect.apply(value, target, [
                  (transaction: unknown) => callback(wrapClient(transaction)),
                  ...argumentsList.slice(1),
                ]),
            );
          };
        }
        if (property === 'unsafe' && typeof value === 'function') {
          return wrap(value);
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

  return wrapClient(database);
}

export async function withTransaction<T>(
  database: DatabaseClient,
  operation: (transaction: DatabaseClient) => Promise<T>,
): Promise<T> {
  return database.begin(async (transaction) => operation(transaction));
}

export async function closeDatabaseClient(
  database: DatabaseClient,
): Promise<void> {
  await database.close({ timeout: 5 });
}

export { loadDatabaseToolConfig } from './config';
export { parseCsv } from './csv';
export {
  ensureLogPartition,
  isMissingLogPartitionError,
  jakartaYear,
  jakartaYearBoundaryUtc,
  LOG_TABLES,
  type LogTable,
  logPartitionName,
  withLogPartitionRecovery,
} from './log-partition';
export {
  assertChecksumMatches,
  DatabaseRunner,
  discoverMigrations,
  discoverSeeds,
} from './runner';
export {
  DATABASE_SCHEMAS,
  DATABASE_SCOPES,
  isDatabaseScope,
  parseMigrationName,
  quoteIdentifier,
  schemaForScope,
  sha256Hex,
} from './tooling';
