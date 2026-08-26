import { type DatabaseClient, withTransaction } from '#project/database';
import type {
  SignalBackfillCheckpoint,
  SignalBackfillCompletion,
  SignalBackfillControl,
  SignalBackfillCursor,
  SignalBackfillRunInput,
  SignalMigrationRun,
  SignalMigrationRunStatus,
} from './backfill';
import { canonicalJson } from './store';
import type { SignalKind } from './types';

const RUN_COLUMNS = [
  'run_id',
  'signal_kind',
  'schema_version',
  'source_from',
  'source_to',
  'source_cursor',
  'source_count',
  'target_count',
  'sample_modulus',
  'source_checksum',
  'target_checksum',
  'status',
  'error_code',
].join(', ');

const SIGNAL_KINDS = new Set<SignalKind>([
  'span',
  'metric_bucket',
  'application_log',
  'access_log',
]);

const RUN_STATUSES = new Set<SignalMigrationRunStatus>([
  'pending',
  'running',
  'paused',
  'succeeded',
  'failed',
]);

export interface PostgresSignalBackfillControlOptions {
  controlDatabase: DatabaseClient;
  now?: () => Date;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid telemetry.signal_migration_runs row');
  }
  return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, name: string): string {
  const value = row[name];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`Invalid telemetry.signal_migration_runs ${name}`);
  }
  return value;
}

function nullableText(
  row: Record<string, unknown>,
  name: string,
): string | null {
  const value = row[name];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new Error(`Invalid telemetry.signal_migration_runs ${name}`);
  }
  return value;
}

function nonnegativeInteger(
  row: Record<string, unknown>,
  name: string,
): number {
  const value = Number(row[name]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid telemetry.signal_migration_runs ${name}`);
  }
  return value;
}

function positiveInteger(row: Record<string, unknown>, name: string): number {
  const value = nonnegativeInteger(row, name);
  if (value < 1) {
    throw new Error(`Invalid telemetry.signal_migration_runs ${name}`);
  }
  return value;
}

function timestamp(row: Record<string, unknown>, name: string): string {
  const value = row[name];
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid telemetry.signal_migration_runs ${name}`);
  }
  return date.toISOString();
}

function cursor(row: Record<string, unknown>): SignalBackfillCursor | null {
  const value = row.source_cursor;
  if (value === null || value === undefined) return null;
  const parsed =
    typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid telemetry.signal_migration_runs source_cursor');
  }
  return parsed as SignalBackfillCursor;
}

function runFromRow(value: unknown): SignalMigrationRun {
  const row = record(value);
  const kind = text(row, 'signal_kind') as SignalKind;
  if (!SIGNAL_KINDS.has(kind)) {
    throw new Error('Invalid telemetry.signal_migration_runs signal_kind');
  }
  const status = text(row, 'status') as SignalMigrationRunStatus;
  if (!RUN_STATUSES.has(status)) {
    throw new Error('Invalid telemetry.signal_migration_runs status');
  }
  return {
    runId: text(row, 'run_id'),
    kind,
    schemaVersion: positiveInteger(row, 'schema_version'),
    sourceFrom: timestamp(row, 'source_from'),
    sourceTo: timestamp(row, 'source_to'),
    sourceCursor: cursor(row),
    sourceCount: nonnegativeInteger(row, 'source_count'),
    targetCount: nonnegativeInteger(row, 'target_count'),
    sampleModulus: positiveInteger(row, 'sample_modulus'),
    sourceChecksum: nullableText(row, 'source_checksum'),
    targetChecksum: nullableText(row, 'target_checksum'),
    status,
    errorCode: nullableText(row, 'error_code'),
  };
}

function rows(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid telemetry.signal_migration_runs query result');
  }
  return value;
}

/**
 * PostgreSQL adapter for the migration Control table. It owns SQL and row
 * parsing only. Cursor ordering and acknowledgement policy stay in the deep
 * SignalBackfillOrchestrator module.
 */
export class PostgresSignalBackfillControl implements SignalBackfillControl {
  private readonly database: DatabaseClient;
  private readonly now: () => Date;

  constructor(options: PostgresSignalBackfillControlOptions) {
    this.database = options.controlDatabase;
    this.now = options.now ?? (() => new Date());
  }

  async getOrCreate(
    input: SignalBackfillRunInput,
  ): Promise<SignalMigrationRun> {
    return await withTransaction(this.database, async (transaction) => {
      const existing = await this.findCurrent(transaction, input);
      if (existing) return existing;

      const inserted = rows(
        await transaction.unsafe(
          `
            INSERT INTO telemetry.signal_migration_runs (
              signal_kind, schema_version, source_from, source_to, sample_modulus
            ) VALUES (
              $1,
              $2,
              ($3::timestamptz AT TIME ZONE 'UTC'),
              ($4::timestamptz AT TIME ZONE 'UTC'),
              $5
            )
            ON CONFLICT DO NOTHING
            RETURNING ${RUN_COLUMNS}
          `,
          [
            input.kind,
            input.schemaVersion,
            input.sourceFrom,
            input.sourceTo,
            input.sampleModulus,
          ] as never[],
        ),
      );
      const created = inserted[0];
      if (created) return runFromRow(created);

      const concurrent = await this.findCurrent(transaction, input);
      if (!concurrent) {
        throw new Error('Could not create telemetry.signal_migration_runs row');
      }
      return concurrent;
    });
  }

  async markRunning(runId: string): Promise<void> {
    await this.update(
      `
        UPDATE telemetry.signal_migration_runs
        SET
          status = 'running',
          error_code = NULL,
          started_at = COALESCE(
            started_at,
            ($2::timestamptz AT TIME ZONE 'UTC')
          )
        WHERE run_id = $1
          AND status IN ('pending', 'running', 'paused')
        RETURNING run_id
      `,
      [runId, this.now().toISOString()],
    );
  }

  async checkpoint(
    runId: string,
    checkpoint: SignalBackfillCheckpoint,
  ): Promise<void> {
    await this.update(
      `
        UPDATE telemetry.signal_migration_runs
        SET
          source_cursor = $2::jsonb,
          source_count = $3,
          error_code = NULL
        WHERE run_id = $1
          AND status = 'running'
        RETURNING run_id
      `,
      [
        runId,
        checkpoint.sourceCursor === null
          ? null
          : canonicalJson(checkpoint.sourceCursor),
        checkpoint.sourceCount,
      ],
    );
  }

  async pause(runId: string, errorCode: string): Promise<void> {
    await this.update(
      `
        UPDATE telemetry.signal_migration_runs
        SET status = 'paused', error_code = $2, finished_at = NULL
        WHERE run_id = $1
          AND status IN ('running', 'paused')
        RETURNING run_id
      `,
      [runId, errorCode],
    );
  }

  async fail(
    runId: string,
    errorCode: string,
    completion?: SignalBackfillCompletion,
  ): Promise<void> {
    await this.update(
      `
        UPDATE telemetry.signal_migration_runs
        SET
          status = 'failed',
          error_code = $2,
          source_count = COALESCE($3, source_count),
          target_count = COALESCE($4, target_count),
          source_checksum = COALESCE($5, source_checksum),
          target_checksum = COALESCE($6, target_checksum),
          finished_at = ($7::timestamptz AT TIME ZONE 'UTC')
        WHERE run_id = $1
          AND status IN ('pending', 'running', 'paused')
        RETURNING run_id
      `,
      [
        runId,
        errorCode,
        completion?.sourceCount ?? null,
        completion?.targetCount ?? null,
        completion?.sourceChecksum ?? null,
        completion?.targetChecksum ?? null,
        this.now().toISOString(),
      ],
    );
  }

  async succeed(
    runId: string,
    completion: SignalBackfillCompletion,
  ): Promise<void> {
    await this.update(
      `
        UPDATE telemetry.signal_migration_runs
        SET
          status = 'succeeded',
          source_count = $2,
          target_count = $3,
          source_checksum = $4,
          target_checksum = $5,
          error_code = NULL,
          finished_at = ($6::timestamptz AT TIME ZONE 'UTC')
        WHERE run_id = $1
          AND status = 'running'
        RETURNING run_id
      `,
      [
        runId,
        completion.sourceCount,
        completion.targetCount,
        completion.sourceChecksum,
        completion.targetChecksum,
        this.now().toISOString(),
      ],
    );
  }

  private async findCurrent(
    database: DatabaseClient,
    input: SignalBackfillRunInput,
  ): Promise<SignalMigrationRun | undefined> {
    const result = rows(
      await database.unsafe(
        `
          SELECT ${RUN_COLUMNS}
          FROM telemetry.signal_migration_runs
          WHERE signal_kind = $1
            AND schema_version = $2
            AND source_from = ($3::timestamptz AT TIME ZONE 'UTC')
            AND source_to = ($4::timestamptz AT TIME ZONE 'UTC')
          ORDER BY
            CASE status
              WHEN 'running' THEN 0
              WHEN 'paused' THEN 1
              WHEN 'pending' THEN 2
              WHEN 'succeeded' THEN 3
              ELSE 4
            END,
            updated_at DESC
          LIMIT 1
          FOR UPDATE
        `,
        [
          input.kind,
          input.schemaVersion,
          input.sourceFrom,
          input.sourceTo,
        ] as never[],
      ),
    );
    const found = result[0];
    return found ? runFromRow(found) : undefined;
  }

  private async update(sql: string, params: unknown[]): Promise<void> {
    const result = rows(await this.database.unsafe(sql, params as never[]));
    if (result.length !== 1) {
      throw new Error('Signal migration run state transition was not applied');
    }
  }
}
