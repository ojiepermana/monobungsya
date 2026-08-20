import type { AppEnvironment } from '#project/config';
import { createDatabaseClient } from '#project/database';

export function createServiceDatabase(environment: AppEnvironment) {
  return createDatabaseClient(environment.DATABASE_URL);
}
