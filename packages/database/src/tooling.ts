import { createHash } from 'node:crypto';

export const DATABASE_SCOPES = {
  auth: 'auth',
  access: 'access',
  user: 'user',
  logs: 'logs',
  jobs: 'jobs',
} as const;

export type DatabaseScope = keyof typeof DATABASE_SCOPES;

export const DATABASE_SCHEMAS = Object.values(DATABASE_SCOPES);
export const MIGRATION_NAME_PATTERN =
  /^(?<number>\d{4})_(?<slug>[a-z][a-z0-9_]*)$/;
export const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;

export interface ParsedMigrationName {
  number: number;
  name: string;
}

export function isDatabaseScope(value: string): value is DatabaseScope {
  return value in DATABASE_SCOPES;
}

export function schemaForScope(scope: DatabaseScope): string {
  return DATABASE_SCOPES[scope];
}

export function parseMigrationName(value: string): ParsedMigrationName {
  const match = MIGRATION_NAME_PATTERN.exec(value);

  if (!match?.groups) {
    throw new Error(
      `invalid migration name "${value}" — expected NNNN_lowercase_name`,
    );
  }

  return {
    number: Number(match.groups.number),
    name: value,
  };
}

export function quoteIdentifier(value: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`invalid SQL identifier "${value}"`);
  }

  return `"${value}"`;
}

export function sha256Hex(contents: string): string {
  return createHash('sha256').update(contents, 'utf8').digest('hex');
}

export function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}
