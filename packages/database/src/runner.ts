import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SQL } from 'bun';
import type { DatabaseToolConfig } from './config';
import { parseCsv } from './csv';
import {
  assertPositiveInteger,
  DATABASE_SCHEMAS,
  type DatabaseScope,
  isDatabaseScope,
  parseMigrationName,
  quoteIdentifier,
  schemaForScope,
  sha256Hex,
} from './tooling';

const TRACKING_TABLES = {
  migrations: 'schema_migrations',
  seeds: 'seed_migrations',
} as const;
const SEED_SETS = ['reference', 'fixtures'] as const;
const CSV_ROWS_PER_INSERT = 1000;
const LOCK_KEY = 'project:database-tooling:v1';
const LEGACY_SCHEMAS = ['users', 'log'] as const;
const SEED_FILE_PATTERN =
  /^(?<number>\d{4})_(?<target>[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?)\.(?<extension>sql|csv)$/;
const IDEMPOTENT_SQL_PATTERN = /ON\s+CONFLICT|DO\s+\$\$|WHERE\s+NOT\s+EXISTS/i;

export interface MigrationFile {
  name: string;
  number: number;
  scope: DatabaseScope;
  path: string;
  downPath: string;
}

export interface SeedFile {
  name: string;
  number: number;
  set: (typeof SEED_SETS)[number];
  scope: DatabaseScope;
  path: string;
  extension: 'sql' | 'csv';
  targetSchema?: string;
  targetTable?: string;
}

export interface FileStatus {
  name: string;
  scope: DatabaseScope;
  checksum: string;
  status: 'pending' | 'applied' | 'checksum-mismatch';
}

export interface RunResult {
  applied: string[];
  skipped: string[];
}

export interface DownResult {
  rolledBack: string[];
}

export interface SeedResetResult {
  cleared: string[];
}

export interface RunnerFilter {
  scope?: DatabaseScope;
  dryRun?: boolean;
}

export class DatabaseRunner {
  private readonly database: SQL;
  private readonly config: DatabaseToolConfig;

  constructor(database: SQL, config: DatabaseToolConfig) {
    this.database = database;
    this.config = config;
  }

  async migrate(filter: RunnerFilter = {}): Promise<RunResult | FileStatus[]> {
    await this.assertDatabaseCompatibility();
    const migrations = discoverMigrations(this.config.migrationsDir);

    if (filter.dryRun) {
      return await this.dryRunTracking(
        'migrations',
        migrations
          .filter(
            (migration) =>
              filter.scope === undefined || migration.scope === filter.scope,
          )
          .map((migration) => ({
            name: migration.name,
            scope: migration.scope,
            path: migration.path,
          })),
      );
    }

    return await this.withLock(
      async (database) =>
        await this.applyMigrations(migrations, filter.scope, database),
    );
  }

  async seed(
    filter: RunnerFilter & { set?: (typeof SEED_SETS)[number] } = {},
  ): Promise<RunResult | FileStatus[]> {
    await this.assertDatabaseCompatibility();
    const seeds = discoverSeeds(this.config.seedsDir);

    if (
      filter.set === 'fixtures' &&
      this.config.nodeEnvironment === 'production'
    ) {
      throw new Error('fixture seeds are disabled in production');
    }

    if (filter.dryRun) {
      return await this.dryRunTracking(
        'seeds',
        seeds
          .filter((seed) => filter.set === undefined || seed.set === filter.set)
          .filter(
            (seed) => filter.scope === undefined || seed.scope === filter.scope,
          )
          .map((seed) => ({
            name: seed.name,
            scope: seed.scope,
            path: seed.path,
          })),
      );
    }

    return await this.withLock(async (database) => {
      const migrations = discoverMigrations(this.config.migrationsDir);
      await this.ensureTrackingTables(database);
      await this.assertAllMigrationsApplied(migrations, database);
      await this.assertAppliedChecksums(migrations, database);
      await this.assertAppliedSeedChecksums(seeds, database);
      return await this.applySeeds(seeds, filter.scope, filter.set, database);
    });
  }

  async reset(
    options: { seed?: boolean; confirm?: boolean } = {},
  ): Promise<RunResult> {
    await this.assertDatabaseCompatibility();

    if (this.config.nodeEnvironment === 'production') {
      throw new Error('db:reset is disabled in production');
    }

    if (!options.confirm) {
      throw new Error('db:reset requires explicit confirmation');
    }

    if (!this.config.resetAllowed) {
      throw new Error('DATABASE_RESET_ALLOWED=true is required for db:reset');
    }

    return await this.withLock(async (database) => {
      await database.unsafe(
        `${DATABASE_SCHEMAS.map((schema) => `DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`).join('; ')}; ` +
          'DROP SCHEMA IF EXISTS "partition" CASCADE; ' +
          'DROP TABLE IF EXISTS "public"."schema_migrations", "public"."seed_migrations" CASCADE',
      );

      const migrations = discoverMigrations(this.config.migrationsDir);
      const result = await this.applyMigrations(
        migrations,
        undefined,
        database,
      );

      if (options.seed) {
        const seeds = discoverSeeds(this.config.seedsDir);
        const seeded = await this.applySeeds(
          seeds,
          undefined,
          undefined,
          database,
        );
        result.applied.push(...seeded.applied);
        result.skipped.push(...seeded.skipped);
      }

      return result;
    });
  }

  async migrateDown(steps = 1, scope?: DatabaseScope): Promise<DownResult> {
    assertPositiveInteger(steps, 'steps');

    if (this.config.nodeEnvironment === 'production') {
      throw new Error('db:migrate:down is disabled in production');
    }

    await this.assertDatabaseCompatibility();

    return await this.withLock(async (database) => {
      const migrations = discoverMigrations(this.config.migrationsDir);
      await this.ensureTrackingTables(database);
      await this.assertAppliedChecksums(migrations, database);
      const byName = new Map(
        migrations.map((migration) => [migration.name, migration]),
      );
      const applied = await this.appliedRows(
        TRACKING_TABLES.migrations,
        database,
      );
      const candidates = applied
        .filter((row) => scope === undefined || row.scope === scope)
        .slice(0, steps);

      const rolledBack: string[] = [];

      for (const row of candidates) {
        const migration = byName.get(row.name);

        if (!migration) {
          throw new Error(
            `cannot roll back "${row.name}" — no matching migration file on disk`,
          );
        }

        await database.begin(async (transaction) => {
          await transaction.unsafe(readFileSync(migration.downPath, 'utf8'));
          await transaction`
            DELETE FROM "public"."schema_migrations"
            WHERE name = ${migration.name}
          `;
        });

        rolledBack.push(migration.name);
      }

      return { rolledBack };
    });
  }

  async resetSeed(scope: DatabaseScope): Promise<SeedResetResult> {
    await this.assertDatabaseCompatibility();

    return await this.withLock(async (database) => {
      await this.ensureTrackingTables(database);
      const rows = await database`
        SELECT name
        FROM "public"."seed_migrations"
        WHERE scope = ${scope}
        ORDER BY applied_at DESC, id DESC
      `;
      await database`
        DELETE FROM "public"."seed_migrations"
        WHERE scope = ${scope}
      `;

      return {
        cleared: rows.map((row: Record<string, unknown>) => String(row.name)),
      };
    });
  }

  private async applyMigrations(
    migrations: MigrationFile[],
    scope?: DatabaseScope,
    database: SQL = this.database,
  ): Promise<RunResult> {
    await this.ensureTrackingTables(database);
    await this.assertAppliedChecksums(migrations, database);
    assertScopeDependencies(
      migrations,
      await this.appliedRows(TRACKING_TABLES.migrations, database),
      scope,
    );

    const appliedRows = await this.appliedRows(
      TRACKING_TABLES.migrations,
      database,
    );
    const appliedNames = new Set(appliedRows.map((row) => row.name));
    const selected = migrations.filter(
      (migration) => scope === undefined || migration.scope === scope,
    );
    const pending = selected.filter(
      (migration) => !appliedNames.has(migration.name),
    );
    const skipped = selected
      .filter((migration) => appliedNames.has(migration.name))
      .map((migration) => migration.name);
    const applied: string[] = [];
    const batch =
      pending.length > 0
        ? await this.nextBatch(TRACKING_TABLES.migrations, database)
        : null;

    for (const migration of pending) {
      const source = readFileSync(migration.path, 'utf8');

      await database.begin(async (transaction) => {
        await transaction.unsafe(source);
        await transaction`
          INSERT INTO "public"."schema_migrations" (name, scope, checksum, batch)
          VALUES (${migration.name}, ${migration.scope}, ${sha256Hex(source)}, ${batch})
        `;
      });

      applied.push(migration.name);
    }

    await this.validateCatalog(database);
    return { applied, skipped };
  }

  private async applySeeds(
    seeds: SeedFile[],
    scope?: DatabaseScope,
    set?: (typeof SEED_SETS)[number],
    database: SQL = this.database,
  ): Promise<RunResult> {
    const appliedRows = await this.appliedRows(TRACKING_TABLES.seeds, database);
    const appliedNames = new Set(appliedRows.map((row) => row.name));
    const selected = seeds.filter(
      (seed) =>
        (scope === undefined || seed.scope === scope) &&
        (set === undefined || seed.set === set),
    );
    const pending = selected.filter((seed) => !appliedNames.has(seed.name));
    const skipped = selected
      .filter((seed) => appliedNames.has(seed.name))
      .map((seed) => seed.name);
    const applied: string[] = [];
    const batch =
      pending.length > 0
        ? await this.nextBatch(TRACKING_TABLES.seeds, database)
        : null;

    for (const seed of pending) {
      const source = readFileSync(seed.path, 'utf8');

      // The first reference user seed predates the permission cutover and is
      // intentionally immutable because its checksum may already be tracked
      // in an existing database. Once user.role is gone, mark that legacy seed
      // as skipped and let the follow-up cutover seed converge the row.
      if (await this.shouldSkipRetiredRoleSeed(seed, database)) {
        await database`
          INSERT INTO "public"."seed_migrations" (name, scope, checksum, batch)
          VALUES (${seed.name}, ${seed.scope}, ${sha256Hex(source)}, ${batch})
        `;
        skipped.push(seed.name);
        continue;
      }

      await database.begin(async (transaction) => {
        await transaction`
          SELECT set_config(
            'app.access_bootstrap_admin_emails',
            ${this.config.accessBootstrapAdminEmails},
            true
          )
        `;
        if (seed.extension === 'csv') {
          await applyCsvSeed(transaction, seed, source);
        } else {
          assertIdempotentSqlSeed(source, seed.name);
          await transaction.unsafe(source);
        }

        await transaction`
          INSERT INTO "public"."seed_migrations" (name, scope, checksum, batch)
          VALUES (${seed.name}, ${seed.scope}, ${sha256Hex(source)}, ${batch})
        `;
      });

      applied.push(seed.name);
    }

    return { applied, skipped };
  }

  private async shouldSkipRetiredRoleSeed(
    seed: SeedFile,
    database: SQL,
  ): Promise<boolean> {
    if (seed.name !== 'reference/user/0001_user.users.sql') return false;

    const rows = await database`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'user'
        AND table_name = 'users'
        AND column_name = 'role'
    `;
    return rows.length === 0;
  }

  private async dryRunTracking(
    table: 'migrations' | 'seeds',
    files: Array<{ name: string; scope: DatabaseScope; path: string }>,
  ): Promise<FileStatus[]> {
    const trackingTable = TRACKING_TABLES[table];
    let rows: AppliedRow[] = [];

    try {
      rows = await this.appliedRows(trackingTable);
    } catch (error) {
      if (!isUndefinedTableError(error)) {
        throw error;
      }
    }

    const applied = new Map(rows.map((row) => [row.name, row]));

    return files.map((file) => {
      const checksum = sha256Hex(readFileSync(file.path, 'utf8'));
      const tracked = applied.get(file.name);

      return {
        name: file.name,
        scope: file.scope,
        checksum,
        status:
          tracked === undefined
            ? 'pending'
            : tracked.checksum === checksum
              ? 'applied'
              : 'checksum-mismatch',
      };
    });
  }

  private async ensureTrackingTables(
    database: SQL = this.database,
  ): Promise<void> {
    for (const table of Object.values(TRACKING_TABLES)) {
      await database.unsafe(`
        CREATE TABLE IF NOT EXISTS "public"."${table}" (
          id uuid PRIMARY KEY DEFAULT uuidv7(),
          name text NOT NULL UNIQUE,
          scope text NOT NULL,
          checksum char(64) NOT NULL,
          batch integer NOT NULL CHECK (batch > 0),
          applied_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT ${table}_id_uuidv7_check
            CHECK ((get_byte(uuid_send(id), 6) >> 4) = 7),
          CONSTRAINT ${table}_checksum_sha256_check
            CHECK (checksum ~ '^[0-9a-f]{64}$')
        )
      `);

      const columns = await database`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table}
      `;
      const present = new Set(
        columns.map((row: Record<string, unknown>) => String(row.column_name)),
      );
      const required = [
        'id',
        'name',
        'scope',
        'checksum',
        'batch',
        'applied_at',
      ];

      if (required.some((column) => !present.has(column))) {
        throw new Error(
          `public.${table} has an old tracking shape; run db:reset before using the canonical runner`,
        );
      }
    }
  }

  private async appliedRows(
    table: string,
    database: SQL = this.database,
  ): Promise<AppliedRow[]> {
    const rows = await database.unsafe(
      `SELECT name, scope, checksum, batch, applied_at, id FROM "public"."${table}" ` +
        'ORDER BY applied_at DESC, id DESC',
    );

    return rows.map((row: Record<string, unknown>) => ({
      name: String(row.name),
      scope: String(row.scope),
      checksum: String(row.checksum),
      batch: Number(row.batch),
      appliedAt: String(row.applied_at),
      id: String(row.id),
    }));
  }

  private async nextBatch(
    table: string,
    database: SQL = this.database,
  ): Promise<number> {
    const [row] = await database.unsafe(
      `SELECT COALESCE(MAX(batch), 0) + 1 AS batch FROM "public"."${table}"`,
    );
    const batch = Number(row?.batch);

    if (!Number.isInteger(batch) || batch <= 0) {
      throw new Error(`could not allocate a batch for public.${table}`);
    }

    return batch;
  }

  private async assertAppliedChecksums(
    migrations: MigrationFile[],
    database: SQL = this.database,
  ): Promise<void> {
    const applied = await this.appliedRows(
      TRACKING_TABLES.migrations,
      database,
    );
    const byName = new Map(
      migrations.map((migration) => [migration.name, migration]),
    );

    for (const row of applied) {
      const migration = byName.get(row.name);

      if (!migration) {
        throw new Error(`applied migration "${row.name}" is missing from disk`);
      }

      assertChecksumMatches(
        row.name,
        readFileSync(migration.path, 'utf8'),
        row.checksum,
        'migration',
      );
    }
  }

  private async assertAppliedSeedChecksums(
    seeds: SeedFile[],
    database: SQL = this.database,
  ): Promise<void> {
    const applied = await this.appliedRows(TRACKING_TABLES.seeds, database);
    const byName = new Map(seeds.map((seed) => [seed.name, seed]));

    for (const row of applied) {
      const seed = byName.get(row.name);

      if (!seed) {
        throw new Error(`applied seed "${row.name}" is missing from disk`);
      }

      assertChecksumMatches(
        row.name,
        readFileSync(seed.path, 'utf8'),
        row.checksum,
        'seed',
      );
    }
  }

  private async assertAllMigrationsApplied(
    migrations: MigrationFile[],
    database: SQL = this.database,
  ): Promise<void> {
    const applied = new Set(
      (await this.appliedRows(TRACKING_TABLES.migrations, database)).map(
        (row) => row.name,
      ),
    );
    const missing = migrations.filter(
      (migration) => !applied.has(migration.name),
    );

    if (missing.length > 0) {
      throw new Error(
        `schema migration is incomplete; run db:migrate first: ${missing.map((migration) => migration.name).join(', ')}`,
      );
    }
  }

  private async validateCatalog(database: SQL = this.database): Promise<void> {
    const legacyRows = await database`
      SELECT nspname
      FROM pg_namespace
      WHERE nspname = ANY(${database.array([...LEGACY_SCHEMAS], 'text')})
    `;

    if (legacyRows.length > 0) {
      throw new Error(
        `legacy schemas are not canonical: ${legacyRows.map((row: Record<string, unknown>) => String(row.nspname)).join(', ')}`,
      );
    }

    const rows = await database`
      SELECT
        namespace.nspname AS schema_name,
        relation.relname AS table_name,
        relation.relkind,
        relation.relispartition,
        EXISTS (
          SELECT 1
          FROM pg_attribute AS attribute
          WHERE attribute.attrelid = relation.oid
            AND attribute.attname = 'id'
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND attribute.atttypid = 'uuid'::regtype
        ) AS has_uuid_id,
        EXISTS (
          SELECT 1
          FROM pg_index AS index_record
          JOIN pg_attribute AS attribute
            ON attribute.attrelid = relation.oid AND attribute.attname = 'id'
          WHERE index_record.indrelid = relation.oid
            AND index_record.indisprimary
            AND (index_record.indnkeyatts = 1 OR relation.relkind = 'p')
            AND index_record.indkey[0] = attribute.attnum
        ) AS has_uuid_primary_key,
        EXISTS (
          SELECT 1
          FROM pg_attribute AS attribute
          JOIN pg_attrdef AS default_record
            ON default_record.adrelid = relation.oid AND default_record.adnum = attribute.attnum
          WHERE attribute.attrelid = relation.oid
            AND attribute.attname = 'id'
            AND lower(pg_get_expr(default_record.adbin, default_record.adrelid)) LIKE '%uuidv7()%'
        ) AS has_uuidv7_default,
        EXISTS (
          SELECT 1
          FROM pg_constraint AS constraint_record
          WHERE constraint_record.conrelid = relation.oid
            AND constraint_record.contype = 'c'
            AND pg_get_constraintdef(constraint_record.oid) LIKE '%= 7%'
        ) AS has_uuidv7_check
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE (
          namespace.nspname = ANY(${database.array(DATABASE_SCHEMAS, 'text')})
          OR (
            namespace.nspname = 'public'
            AND relation.relname = ANY(${database.array(Object.values(TRACKING_TABLES), 'text')})
          )
        )
        AND relation.relkind IN ('r', 'p')
        AND NOT relation.relispartition
    `;

    for (const row of rows) {
      if (
        !row.has_uuid_id ||
        !row.has_uuid_primary_key ||
        !row.has_uuidv7_default ||
        !row.has_uuidv7_check
      ) {
        throw new Error(
          `catalog validation failed for ${String(row.schema_name)}.${String(row.table_name)}: every application table needs a UUIDv7 id primary key`,
        );
      }
    }
  }

  private async assertDatabaseCompatibility(): Promise<void> {
    const [versionRow] = await this.database`SHOW server_version_num`;
    const version = Number(versionRow?.server_version_num);
    const major = Math.floor(version / 10_000);

    if (major !== 18) {
      throw new Error(
        `PostgreSQL 18 is required, found server_version_num ${version}`,
      );
    }

    try {
      await this.database`SELECT uuidv7()`;
    } catch (error) {
      throw new Error(
        `PostgreSQL 18 uuidv7() is unavailable; verify the target server and native function support: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async withLock<T>(
    operation: (database: SQL) => Promise<T>,
  ): Promise<T> {
    const reserved = await this.database.reserve();
    let locked = false;
    const deadline = Date.now() + this.config.lockTimeoutMs;

    try {
      while (!locked && Date.now() < deadline) {
        const [row] = await reserved`
          SELECT pg_try_advisory_lock(hashtext(${LOCK_KEY})) AS locked
        `;
        locked = Boolean(row?.locked);

        if (!locked) {
          await wait(this.config.lockPollMs);
        }
      }

      if (!locked) {
        throw new Error(
          `database tooling lock timed out after ${this.config.lockTimeoutMs}ms`,
        );
      }

      return await operation(reserved);
    } finally {
      if (locked) {
        await reserved`
          SELECT pg_advisory_unlock(hashtext(${LOCK_KEY}))
        `;
      }

      reserved.release();
    }
  }
}

interface AppliedRow {
  name: string;
  scope: string;
  checksum: string;
  batch: number;
  appliedAt: string;
  id: string;
}

export function discoverMigrations(directory: string): MigrationFile[] {
  assertDirectory(directory, 'migration');
  const files: MigrationFile[] = [];
  const scopes = readdirSync(directory, { withFileTypes: true });

  for (const entry of scopes) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (!isDatabaseScope(entry.name)) {
      throw new Error(`unknown migration scope directory "${entry.name}"`);
    }

    const scopeDirectory = join(directory, entry.name);

    for (const file of readdirSync(scopeDirectory)) {
      if (file.endsWith('.down.sql')) {
        continue;
      }

      if (!file.endsWith('.up.sql')) {
        if (file.endsWith('.sql')) {
          throw new Error(
            `migration file "${file}" must use .up.sql or .down.sql`,
          );
        }

        continue;
      }

      const name = file.slice(0, -'.up.sql'.length);
      const parsed = parseMigrationName(name);
      const downPath = join(scopeDirectory, `${name}.down.sql`);

      if (!existsSync(downPath)) {
        throw new Error(`migration "${name}" is missing ${name}.down.sql`);
      }

      files.push({
        name,
        number: parsed.number,
        scope: entry.name,
        path: join(scopeDirectory, file),
        downPath,
      });
    }
  }

  assertUniqueMigrationNames(files);
  return files.sort(compareFiles);
}

export function discoverSeeds(directory: string): SeedFile[] {
  assertDirectory(directory, 'seed');
  const files: SeedFile[] = [];

  for (const setEntry of readdirSync(directory, { withFileTypes: true })) {
    if (!setEntry.isDirectory()) {
      continue;
    }

    if (!SEED_SETS.includes(setEntry.name as (typeof SEED_SETS)[number])) {
      throw new Error(`unknown seed set directory "${setEntry.name}"`);
    }

    const set = setEntry.name as (typeof SEED_SETS)[number];
    const setDirectory = join(directory, set);

    for (const scopeEntry of readdirSync(setDirectory, {
      withFileTypes: true,
    })) {
      if (!scopeEntry.isDirectory()) {
        continue;
      }

      if (!isDatabaseScope(scopeEntry.name)) {
        throw new Error(`unknown seed scope directory "${scopeEntry.name}"`);
      }

      const scope = scopeEntry.name;
      const scopeDirectory = join(setDirectory, scope);

      for (const file of readdirSync(scopeDirectory)) {
        if (!file.endsWith('.sql') && !file.endsWith('.csv')) {
          continue;
        }

        const match = SEED_FILE_PATTERN.exec(file);

        if (!match?.groups) {
          throw new Error(
            `seed file "${file}" must use NNNN_target.sql or NNNN_schema.table.csv`,
          );
        }

        const number = Number(match.groups.number);
        const extension = match.groups.extension as 'sql' | 'csv';
        const target = match.groups.target?.split('.') ?? [];
        const name = `${set}/${scope}/${file}`;
        const seed: SeedFile = {
          name,
          number,
          set,
          scope,
          path: join(scopeDirectory, file),
          extension,
        };

        if (extension === 'csv') {
          if (target.length !== 2) {
            throw new Error(`CSV seed "${file}" must include schema and table`);
          }

          if (target[0] !== schemaForScope(scope)) {
            throw new Error(
              `CSV seed "${file}" targets schema "${target[0]}", expected "${schemaForScope(scope)}" for scope ${scope}`,
            );
          }

          seed.targetSchema = target[0];
          seed.targetTable = target[1];
        }

        files.push(seed);
      }
    }
  }

  const names = new Set<string>();
  const numbers = new Set<number>();

  for (const file of files) {
    if (names.has(file.name)) {
      throw new Error(`duplicate seed name "${file.name}"`);
    }

    if (numbers.has(file.number)) {
      throw new Error(`duplicate global seed number "${file.number}"`);
    }

    names.add(file.name);
    numbers.add(file.number);
  }

  return files.sort(compareFiles);
}

export function assertChecksumMatches(
  name: string,
  source: string,
  expected: string,
  kind: 'migration' | 'seed',
): void {
  const actual = sha256Hex(source);

  if (actual !== expected) {
    throw new Error(
      `checksum mismatch for ${kind} "${name}" — create a new ${kind} instead of editing an applied file`,
    );
  }
}

function assertDirectory(directory: string, type: string): void {
  if (!existsSync(directory)) {
    throw new Error(`${type} directory does not exist: ${directory}`);
  }
}

function assertUniqueMigrationNames(files: MigrationFile[]): void {
  const names = new Set<string>();
  const numbers = new Set<number>();

  for (const file of files) {
    if (names.has(file.name)) {
      throw new Error(`duplicate migration name "${file.name}"`);
    }

    if (numbers.has(file.number)) {
      throw new Error(`duplicate global migration number "${file.number}"`);
    }

    names.add(file.name);
    numbers.add(file.number);
  }
}

function compareFiles(
  first: { number: number; name: string },
  second: { number: number; name: string },
): number {
  return first.number - second.number || first.name.localeCompare(second.name);
}

function assertScopeDependencies(
  migrations: MigrationFile[],
  applied: AppliedRow[],
  scope?: DatabaseScope,
): void {
  if (scope === undefined) {
    return;
  }

  const appliedNames = new Set(applied.map((row) => row.name));
  const selected = migrations.filter(
    (migration) =>
      migration.scope === scope && !appliedNames.has(migration.name),
  );
  const missing = new Set<string>();

  for (const migration of selected) {
    for (const dependency of migrations) {
      if (
        dependency.number < migration.number &&
        !appliedNames.has(dependency.name)
      ) {
        missing.add(dependency.name);
      }
    }
  }

  if (missing.size > 0) {
    throw new Error(
      `scope ${scope} has unapplied global migration dependencies: ${[...missing].join(', ')}`,
    );
  }
}

function assertIdempotentSqlSeed(source: string, name: string): void {
  if (!IDEMPOTENT_SQL_PATTERN.test(source)) {
    throw new Error(
      `SQL seed "${name}" must use ON CONFLICT, an existence check, or a controlled DO block`,
    );
  }
}

async function applyCsvSeed(
  transaction: SQL,
  seed: SeedFile,
  source: string,
): Promise<void> {
  if (!seed.targetSchema || !seed.targetTable) {
    throw new Error(`CSV seed "${seed.name}" has no target table`);
  }

  const rows = parseCsv(source);

  if (rows.length === 0) {
    return;
  }

  const firstRow = rows[0];

  if (!firstRow) {
    return;
  }

  const columns = Object.keys(firstRow);
  const table = `${quoteIdentifier(seed.targetSchema)}.${quoteIdentifier(seed.targetTable)}`;
  const columnList = columns.map(quoteIdentifier).join(', ');

  for (let offset = 0; offset < rows.length; offset += CSV_ROWS_PER_INSERT) {
    const chunk = rows.slice(offset, offset + CSV_ROWS_PER_INSERT);
    const placeholders = chunk
      .map(
        (_, rowIndex) =>
          `(${columns.map((_, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(', ')})`,
      )
      .join(', ');
    const parameters = chunk.flatMap((row) =>
      columns.map((column) => {
        const value = row[column] ?? '';
        return value === '' ? null : value;
      }),
    );

    await transaction.unsafe(
      `INSERT INTO ${table} (${columnList}) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
      parameters,
    );
  }
}

function isUndefinedTableError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '42P01'
  );
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
