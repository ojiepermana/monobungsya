import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface ClickHouseMigrationSource {
  path: string;
  source: string;
}

export interface ClickHouseMigration {
  version: number;
  name: string;
  checksum: string;
  sql: string;
}

const MIGRATION_NAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeSql(value: string): string {
  return value.trim().replace(/;+$/, '');
}

export function parseClickHouseMigrations(
  sources: readonly ClickHouseMigrationSource[],
): ClickHouseMigration[] {
  const migrations = sources.map((source) => {
    const fileName = source.path.split('/').at(-1);
    const match = fileName ? MIGRATION_NAME.exec(fileName) : null;
    if (!match) {
      throw new Error(`Invalid ClickHouse migration file: ${source.path}`);
    }
    const version = Number(match[1]);
    const name = match[2];
    const sql = normalizeSql(source.source);
    if (!name || sql === '' || /;\s*\S/.test(sql)) {
      throw new Error(
        `ClickHouse migration must contain one statement: ${source.path}`,
      );
    }
    return {
      version,
      name,
      checksum: sha256(source.source),
      sql,
    };
  });

  migrations.sort((left, right) => left.version - right.version);
  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index - 1]?.version === migrations[index]?.version) {
      throw new Error(
        `Duplicate ClickHouse migration version: ${migrations[index]?.version}`,
      );
    }
  }
  return migrations;
}

export async function discoverClickHouseMigrations(
  directory = join(import.meta.dir, '../../migrations/clickhouse'),
): Promise<ClickHouseMigration[]> {
  const fileNames = (await readdir(directory))
    .filter((fileName) => MIGRATION_NAME.test(fileName))
    .sort();
  const sources = await Promise.all(
    fileNames.map(async (fileName) => {
      const path = join(directory, fileName);
      return { path, source: await Bun.file(path).text() };
    }),
  );
  return parseClickHouseMigrations(sources);
}
