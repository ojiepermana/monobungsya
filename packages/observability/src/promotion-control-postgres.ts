import { type DatabaseClient, withTransaction } from '#project/database';
import {
  classifySignalRollback,
  evaluateSignalPromotion,
  type SignalPromotionDecision,
  type SignalPromotionEvidence,
  type SignalPromotionInput,
  type SignalPromotionStorageMode,
} from './promotion';

const REPORT_COLUMNS = [
  'id AS report_id',
  'from_write_mode',
  'from_read_mode',
  'to_write_mode',
  'to_read_mode',
  'evaluated_at',
  'evidence',
  'decision',
  'artifact_uri',
  'recorded_by',
  'recorded_at',
].join(', ');

const ACTIVATION_COLUMNS = [
  'id AS activation_id',
  'activation_kind',
  'from_write_mode',
  'from_read_mode',
  'to_write_mode',
  'to_read_mode',
  'report_id',
  'activated_by',
  'activated_at',
  'blind_spot_since',
].join(', ');

const WRITE_MODES = new Set(['postgres', 'dual', 'clickhouse']);
const READ_MODES = new Set(['postgres', 'clickhouse']);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BASELINE_STORAGE_MODE: SignalPromotionStorageMode = {
  writeMode: 'postgres',
  readMode: 'postgres',
};
const DUAL_POSTGRES_STORAGE_MODE: SignalPromotionStorageMode = {
  writeMode: 'dual',
  readMode: 'postgres',
};
const DUAL_CLICKHOUSE_STORAGE_MODE: SignalPromotionStorageMode = {
  writeMode: 'dual',
  readMode: 'clickhouse',
};
const CLICKHOUSE_STORAGE_MODE: SignalPromotionStorageMode = {
  writeMode: 'clickhouse',
  readMode: 'clickhouse',
};

export interface SignalPromotionReport {
  readonly reportId: string;
  readonly from: SignalPromotionStorageMode;
  readonly to: SignalPromotionStorageMode;
  readonly evaluatedAt: string;
  readonly evidence: SignalPromotionEvidence;
  readonly decision: SignalPromotionDecision;
  readonly artifactUri: string;
  readonly recordedBy: string;
  readonly recordedAt: string;
}

export interface RecordSignalPromotionInput extends SignalPromotionInput {
  readonly artifactUri: string;
  readonly recordedBy: string;
}

export type SignalStorageActivationKind = 'initial' | 'forward' | 'rollback';

export interface SignalStorageActivation {
  readonly activationId: string;
  readonly kind: SignalStorageActivationKind;
  readonly from: SignalPromotionStorageMode;
  readonly to: SignalPromotionStorageMode;
  /** Required for an advanced forward cutover and absent for baseline/rollback. */
  readonly reportId: string | null;
  readonly activatedBy: string;
  readonly activatedAt: string;
  /** Present only when a writer cutover rollback leaves PostgreSQL incomplete. */
  readonly blindSpotSince: string | null;
}

export interface ActivateSignalStorageInput {
  readonly from: SignalPromotionStorageMode;
  readonly to: SignalPromotionStorageMode;
  readonly reportId: string | null;
  readonly activatedBy: string;
}

/**
 * The narrow runtime seam used by process roots. It accepts a configured
 * non-baseline state only when an immutable activation is current in Control.
 */
export interface SignalPromotionApprovalControl {
  allowsPromotion(
    reportId: string,
    target: SignalPromotionStorageMode,
  ): Promise<boolean>;
  allowsActivatedStorageMode(
    target: SignalPromotionStorageMode,
    reportId: string | null,
  ): Promise<boolean>;
}

export interface PostgresSignalPromotionControlOptions {
  controlDatabase: DatabaseClient;
  now?: () => Date;
}

interface ResolvedActivationInput {
  readonly kind: Exclude<SignalStorageActivationKind, 'initial'>;
  readonly from: SignalPromotionStorageMode;
  readonly to: SignalPromotionStorageMode;
  readonly reportId: string | null;
  readonly activatedBy: string;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid telemetry Control ${label}`);
  }
  return value as Record<string, unknown>;
}

function nonemptyText(row: Record<string, unknown>, name: string): string {
  const value = row[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid telemetry Control ${name}`);
  }
  return value;
}

function optionalUuid(
  row: Record<string, unknown>,
  name: string,
): string | null {
  const value = row[name];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`Invalid telemetry Control ${name}`);
  }
  return value;
}

function timestamp(row: Record<string, unknown>, name: string): string {
  const value = row[name];
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid telemetry Control ${name}`);
  }
  return parsed.toISOString();
}

function nullableTimestamp(
  row: Record<string, unknown>,
  name: string,
): string | null {
  const value = row[name];
  if (value === null || value === undefined) return null;
  return timestamp(row, name);
}

function parseJson(value: unknown, name: string): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new Error(`Invalid telemetry Control ${name}`);
    }
  }
  return value;
}

function matchingStorageMode(
  actual: SignalPromotionStorageMode,
  expected: SignalPromotionStorageMode,
): boolean {
  return (
    actual.writeMode === expected.writeMode &&
    actual.readMode === expected.readMode
  );
}

function validStorageMode(mode: SignalPromotionStorageMode): boolean {
  return (
    matchingStorageMode(mode, BASELINE_STORAGE_MODE) ||
    matchingStorageMode(mode, DUAL_POSTGRES_STORAGE_MODE) ||
    matchingStorageMode(mode, DUAL_CLICKHOUSE_STORAGE_MODE) ||
    matchingStorageMode(mode, CLICKHOUSE_STORAGE_MODE)
  );
}

function storageMode(
  row: Record<string, unknown>,
  prefix: 'from' | 'to',
): SignalPromotionStorageMode {
  const writeMode = nonemptyText(row, `${prefix}_write_mode`);
  const readMode = nonemptyText(row, `${prefix}_read_mode`);
  if (!WRITE_MODES.has(writeMode) || !READ_MODES.has(readMode)) {
    throw new Error(`Invalid telemetry Control ${prefix} mode`);
  }
  const mode = {
    writeMode: writeMode as SignalPromotionStorageMode['writeMode'],
    readMode: readMode as SignalPromotionStorageMode['readMode'],
  };
  if (!validStorageMode(mode)) {
    throw new Error(`Invalid telemetry Control ${prefix} mode`);
  }
  return mode;
}

function reportFromRow(value: unknown): SignalPromotionReport {
  const row = asRecord(value, 'promotion report row');
  return {
    reportId: nonemptyText(row, 'report_id'),
    from: storageMode(row, 'from'),
    to: storageMode(row, 'to'),
    evaluatedAt: timestamp(row, 'evaluated_at'),
    evidence: parseJson(row.evidence, 'evidence') as SignalPromotionEvidence,
    decision: parseJson(row.decision, 'decision') as SignalPromotionDecision,
    artifactUri: nonemptyText(row, 'artifact_uri'),
    recordedBy: nonemptyText(row, 'recorded_by'),
    recordedAt: timestamp(row, 'recorded_at'),
  };
}

function activationFromRow(value: unknown): SignalStorageActivation {
  const row = asRecord(value, 'storage activation row');
  const kind = nonemptyText(row, 'activation_kind');
  if (kind !== 'initial' && kind !== 'forward' && kind !== 'rollback') {
    throw new Error('Invalid telemetry Control activation_kind');
  }
  return {
    activationId: nonemptyText(row, 'activation_id'),
    kind,
    from: storageMode(row, 'from'),
    to: storageMode(row, 'to'),
    reportId: optionalUuid(row, 'report_id'),
    activatedBy: nonemptyText(row, 'activated_by'),
    activatedAt: timestamp(row, 'activated_at'),
    blindSpotSince: nullableTimestamp(row, 'blind_spot_since'),
  };
}

function resolvedActivationInput(
  input: ActivateSignalStorageInput,
): ResolvedActivationInput {
  if (!validStorageMode(input.from) || !validStorageMode(input.to)) {
    throw new Error('Invalid Signal storage activation mode');
  }
  const activatedBy = input.activatedBy.trim();
  if (!activatedBy || activatedBy.length > 200) {
    throw new Error(
      'Signal storage activation actor must be 1 to 200 characters',
    );
  }
  const reportId = input.reportId?.trim() || null;
  if (reportId && !UUID_PATTERN.test(reportId)) {
    throw new Error('Signal storage activation report ID must be a UUID');
  }

  if (
    matchingStorageMode(input.from, BASELINE_STORAGE_MODE) &&
    matchingStorageMode(input.to, DUAL_POSTGRES_STORAGE_MODE) &&
    reportId === null
  ) {
    return { kind: 'forward', ...input, reportId, activatedBy };
  }
  if (
    matchingStorageMode(input.from, DUAL_POSTGRES_STORAGE_MODE) &&
    matchingStorageMode(input.to, DUAL_CLICKHOUSE_STORAGE_MODE) &&
    reportId !== null
  ) {
    return { kind: 'forward', ...input, reportId, activatedBy };
  }
  if (
    matchingStorageMode(input.from, DUAL_CLICKHOUSE_STORAGE_MODE) &&
    matchingStorageMode(input.to, CLICKHOUSE_STORAGE_MODE) &&
    reportId !== null
  ) {
    return { kind: 'forward', ...input, reportId, activatedBy };
  }
  if (
    (matchingStorageMode(input.from, DUAL_CLICKHOUSE_STORAGE_MODE) ||
      matchingStorageMode(input.from, CLICKHOUSE_STORAGE_MODE)) &&
    matchingStorageMode(input.to, DUAL_POSTGRES_STORAGE_MODE) &&
    reportId === null
  ) {
    return { kind: 'rollback', ...input, reportId, activatedBy };
  }

  throw new Error(
    `Invalid Signal storage activation transition: ${input.from.writeMode}/${input.from.readMode} to ${input.to.writeMode}/${input.to.readMode}`,
  );
}

async function approvedReportForTarget(
  database: DatabaseClient,
  reportId: string,
  target: SignalPromotionStorageMode,
  evaluatedAt: string,
): Promise<SignalPromotionReport | null> {
  const result = (await database.unsafe(
    `
      SELECT ${REPORT_COLUMNS}
      FROM telemetry.signal_promotion_reports
      WHERE id = $1
      LIMIT 1
    `,
    [reportId] as never[],
  )) as unknown[];
  if (result.length !== 1) return null;

  try {
    const report = reportFromRow(result[0]);
    if (!matchingStorageMode(report.to, target)) return null;
    const recomputed = evaluateSignalPromotion({
      from: report.from,
      to: report.to,
      evaluatedAt,
      evidence: report.evidence,
    });
    return recomputed.allowed && report.decision.allowed === true
      ? report
      : null;
  } catch {
    return null;
  }
}

async function currentActivation(
  database: DatabaseClient,
): Promise<SignalStorageActivation | null> {
  const result = (await database.unsafe(
    `
      SELECT ${ACTIVATION_COLUMNS}
      FROM telemetry.signal_storage_activations
      ORDER BY activation_sequence DESC
      LIMIT 1
    `,
  )) as unknown[];
  if (result.length === 0) return null;
  return activationFromRow(result[0]);
}

/**
 * PostgreSQL Control owns immutable evidence and an immutable activation
 * ledger. A report authorizes one forward activation; configuration alone
 * can never skip a state or replay that report after rollback.
 */
export class PostgresSignalPromotionControl
  implements SignalPromotionApprovalControl
{
  private readonly database: DatabaseClient;
  private readonly now: () => Date;

  constructor(options: PostgresSignalPromotionControlOptions) {
    this.database = options.controlDatabase;
    this.now = options.now ?? (() => new Date());
  }

  async record(
    input: RecordSignalPromotionInput,
  ): Promise<SignalPromotionReport> {
    const decision = evaluateSignalPromotion(input);
    const result = (await this.database.unsafe(
      `
        INSERT INTO telemetry.signal_promotion_reports (
          from_write_mode,
          from_read_mode,
          to_write_mode,
          to_read_mode,
          evaluated_at,
          evidence,
          decision,
          artifact_uri,
          recorded_by
        ) VALUES ($1, $2, $3, $4, ($5::timestamptz AT TIME ZONE 'UTC'), $6::jsonb, $7::jsonb, $8, $9)
        RETURNING ${REPORT_COLUMNS}
      `,
      [
        input.from.writeMode,
        input.from.readMode,
        input.to.writeMode,
        input.to.readMode,
        input.evaluatedAt,
        input.evidence,
        decision,
        input.artifactUri,
        input.recordedBy,
      ] as never[],
    )) as unknown[];
    if (result.length !== 1) {
      throw new Error('Signal promotion report was not recorded');
    }
    return reportFromRow(result[0]);
  }

  async allowsPromotion(
    reportId: string,
    target: SignalPromotionStorageMode,
  ): Promise<boolean> {
    return (
      (await approvedReportForTarget(
        this.database,
        reportId,
        target,
        this.now().toISOString(),
      )) !== null
    );
  }

  async allowsActivatedStorageMode(
    target: SignalPromotionStorageMode,
    reportId: string | null,
  ): Promise<boolean> {
    try {
      const activation = await currentActivation(this.database);
      return (
        activation !== null &&
        matchingStorageMode(activation.to, target) &&
        activation.reportId === reportId
      );
    } catch {
      return false;
    }
  }

  async activate(
    input: ActivateSignalStorageInput,
  ): Promise<SignalStorageActivation> {
    const activation = resolvedActivationInput(input);
    return withTransaction(this.database, async (database) => {
      const activatedAt = this.now().toISOString();
      await database.unsafe(
        "SELECT pg_advisory_xact_lock(hashtextextended('telemetry.signal_storage_activation', 0))",
      );
      const current = await currentActivation(database);
      if (!current) {
        throw new Error('Signal storage activation state is missing');
      }
      if (!matchingStorageMode(current.to, activation.from)) {
        throw new Error(
          `Signal storage activation requires current mode ${activation.from.writeMode}/${activation.from.readMode}`,
        );
      }

      let blindSpotSince: string | null = null;
      if (activation.kind === 'rollback') {
        const activePromotion =
          current.to.writeMode !== 'dual' || current.reportId === null
            ? null
            : await approvedReportForTarget(
                database,
                current.reportId,
                current.to,
                activatedAt,
              );
        const classification = classifySignalRollback({
          current: current.to,
          rollbackRequestedAt: activatedAt,
          postgresShadowUntil:
            activePromotion?.evidence.rollbackWindow.endsAt ?? null,
          writerCutoverAt:
            current.to.writeMode === 'clickhouse' ? current.activatedAt : null,
        });
        if (
          classification.target === null ||
          !matchingStorageMode(classification.target, activation.to)
        ) {
          throw new Error(
            'Signal storage rollback window is not currently safe',
          );
        }
        if (
          classification.kind === 'writer_cutover_blind_spot' &&
          classification.blindSpotSince === null
        ) {
          throw new Error(
            'Signal storage writer rollback requires a recorded cutover instant',
          );
        }
        blindSpotSince = classification.blindSpotSince;
      }

      if (activation.reportId !== null) {
        const report = await approvedReportForTarget(
          database,
          activation.reportId,
          activation.to,
          activatedAt,
        );
        if (
          !report ||
          !matchingStorageMode(report.from, activation.from) ||
          !matchingStorageMode(report.to, activation.to)
        ) {
          throw new Error(
            'Signal storage activation requires an approved report for its exact transition',
          );
        }
      }

      const result = (await database.unsafe(
        `
          INSERT INTO telemetry.signal_storage_activations (
            activation_kind,
            from_write_mode,
            from_read_mode,
            to_write_mode,
            to_read_mode,
            report_id,
            activated_by,
            activated_at,
            blind_spot_since
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, ($8::timestamptz AT TIME ZONE 'UTC'), ($9::timestamptz AT TIME ZONE 'UTC'))
          RETURNING ${ACTIVATION_COLUMNS}
        `,
        [
          activation.kind,
          activation.from.writeMode,
          activation.from.readMode,
          activation.to.writeMode,
          activation.to.readMode,
          activation.reportId,
          activation.activatedBy,
          activatedAt,
          blindSpotSince,
        ] as never[],
      )) as unknown[];
      if (result.length !== 1) {
        throw new Error('Signal storage activation was not recorded');
      }
      return activationFromRow(result[0]);
    });
  }
}
