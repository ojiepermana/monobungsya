import { SQL } from "bun";

export type DatabaseClient = SQL;

export function createDatabaseClient(connectionString: string): DatabaseClient {
  return new SQL(connectionString, {
    max: 10,
    connectionTimeout: 10,
  });
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

export { loadDatabaseToolConfig } from "./config";
export { parseCsv } from "./csv";
export {
  assertChecksumMatches,
  DatabaseRunner,
  discoverMigrations,
  discoverSeeds,
} from "./runner";
export {
  DATABASE_SCHEMAS,
  DATABASE_SCOPES,
  isDatabaseScope,
  parseMigrationName,
  quoteIdentifier,
  schemaForScope,
  sha256Hex,
} from "./tooling";
