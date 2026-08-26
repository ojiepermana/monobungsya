/**
 * A pure promotion gate for the configured Signal storage transitions.
 *
 * Callers collect the durable PostgreSQL Control report and inject it here.
 * This module deliberately neither reads configuration nor writes Control
 * records, so an operator cannot promote based on an implicit local default.
 */

export const MINIMUM_SHADOW_DAYS = 7;
export const MINIMUM_ACKNOWLEDGEMENT_RATIO = 0.999;
export const MINIMUM_ROLLBACK_WINDOW_MS =
  MINIMUM_SHADOW_DAYS * 24 * 60 * 60 * 1_000;

export type SignalPromotionWriteMode = 'postgres' | 'dual' | 'clickhouse';
export type SignalPromotionReadMode = 'postgres' | 'clickhouse';

export interface SignalPromotionStorageMode {
  readonly writeMode: SignalPromotionWriteMode;
  readonly readMode: SignalPromotionReadMode;
}

export interface SignalBatchAcknowledgement {
  readonly acceptedBatches: number;
  readonly acknowledgedBatches: number;
}

export interface SignalPromotionAcknowledgements {
  readonly overall: SignalBatchAcknowledgement;
  readonly span: SignalBatchAcknowledgement;
  readonly metricBucket: SignalBatchAcknowledgement;
  readonly applicationLog: SignalBatchAcknowledgement;
  readonly accessLog: SignalBatchAcknowledgement;
}

export interface SignalPromotionParityEvidence {
  readonly backfillCompleted: boolean;
  readonly latestIdentityCountsMatch: boolean;
  readonly deterministicSampleChecksumsMatch: boolean;
  readonly queryParityPassed: boolean;
}

export interface SignalPromotionGateEvidence {
  readonly ingestSloGreen: boolean;
  readonly querySloGreen: boolean;
  readonly capacityQualified: boolean;
  readonly diskHeadroomSatisfied: boolean;
  readonly schemaHealthy: boolean;
  readonly securityClear: boolean;
  readonly availabilityHealthy: boolean;
}

export interface SignalPromotionHumanApproval {
  readonly approved: boolean;
  readonly actorId: string | null;
  readonly approvedAt: string | null;
}

/**
 * The time range in which PostgreSQL still receives a complete Signal shadow.
 * Its timestamps are evidence data, not values inferred from the current mode.
 */
export interface SignalPromotionRollbackWindow {
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly postgresShadowAvailable: boolean;
}

/**
 * Evidence is injected by the caller from a signed or otherwise trusted
 * Control report. There are two distinct seven day requirements: dual write
 * before reader promotion and PostgreSQL shadow after it, before writer
 * promotion.
 */
export interface SignalPromotionEvidence {
  readonly consecutiveDualWriteDays: number;
  readonly consecutivePostgresShadowDays: number;
  readonly acknowledgements: SignalPromotionAcknowledgements;
  readonly parity: SignalPromotionParityEvidence;
  readonly gates: SignalPromotionGateEvidence;
  readonly humanApproval: SignalPromotionHumanApproval;
  readonly rollbackWindow: SignalPromotionRollbackWindow;
}

export interface SignalPromotionInput {
  readonly from: SignalPromotionStorageMode;
  readonly to: SignalPromotionStorageMode;
  /** Injected by the caller so this evaluator has no ambient clock. */
  readonly evaluatedAt: string;
  readonly evidence: SignalPromotionEvidence;
}

export type SignalPromotionKind = 'reader' | 'writer' | 'invalid';

export type SignalPromotionFailureCode =
  | 'invalid_transition'
  | 'dual_write_shadow_incomplete'
  | 'postgres_shadow_incomplete'
  | 'overall_acknowledgement_ratio_insufficient'
  | 'per_signal_acknowledgement_ratio_insufficient'
  | 'backfill_incomplete'
  | 'latest_identity_count_mismatch'
  | 'deterministic_sample_checksum_mismatch'
  | 'query_parity_failed'
  | 'ingest_slo_not_green'
  | 'query_slo_not_green'
  | 'capacity_not_qualified'
  | 'disk_headroom_insufficient'
  | 'schema_not_healthy'
  | 'security_gate_not_clear'
  | 'availability_not_healthy'
  | 'human_approval_missing'
  | 'rollback_window_invalid';

export interface SignalPromotionAcknowledgementRatios {
  readonly overall: number | null;
  readonly span: number | null;
  readonly metricBucket: number | null;
  readonly applicationLog: number | null;
  readonly accessLog: number | null;
}

export interface SignalPromotionDecision {
  readonly kind: SignalPromotionKind;
  readonly allowed: boolean;
  readonly failures: readonly SignalPromotionFailureCode[];
  readonly acknowledgementRatios: SignalPromotionAcknowledgementRatios;
}

export interface SignalRollbackInput {
  readonly current: SignalPromotionStorageMode;
  /** Injected request time. This classifier never consults the system clock. */
  readonly rollbackRequestedAt: string;
  /** End of the currently complete PostgreSQL shadow, if still in dual mode. */
  readonly postgresShadowUntil: string | null;
  /** The instant PostgreSQL Signal writes stopped, if writer cutover happened. */
  readonly writerCutoverAt: string | null;
}

export type SignalRollbackClassification =
  | {
      readonly kind: 'safe_shadow_rollback';
      readonly target: {
        readonly writeMode: 'dual';
        readonly readMode: 'postgres';
      };
      readonly blindSpotSince: null;
    }
  | {
      readonly kind: 'writer_cutover_blind_spot';
      readonly target: {
        readonly writeMode: 'dual';
        readonly readMode: 'postgres';
      };
      /** PostgreSQL lacks Signals from this instant forward. */
      readonly blindSpotSince: string | null;
    }
  | {
      readonly kind: 'rollback_window_expired';
      readonly target: null;
      readonly blindSpotSince: null;
    }
  | {
      readonly kind: 'already_on_postgres_reader';
      readonly target: null;
      readonly blindSpotSince: null;
    };

function isReaderPromotion(input: SignalPromotionInput): boolean {
  return (
    input.from.writeMode === 'dual' &&
    input.from.readMode === 'postgres' &&
    input.to.writeMode === 'dual' &&
    input.to.readMode === 'clickhouse'
  );
}

function isWriterPromotion(input: SignalPromotionInput): boolean {
  return (
    input.from.writeMode === 'dual' &&
    input.from.readMode === 'clickhouse' &&
    input.to.writeMode === 'clickhouse' &&
    input.to.readMode === 'clickhouse'
  );
}

function acknowledgementRatio(
  acknowledgement: SignalBatchAcknowledgement | undefined,
): number | null {
  if (
    !acknowledgement ||
    !Number.isSafeInteger(acknowledgement.acceptedBatches) ||
    !Number.isSafeInteger(acknowledgement.acknowledgedBatches) ||
    acknowledgement.acceptedBatches < 1 ||
    acknowledgement.acknowledgedBatches < 0 ||
    acknowledgement.acknowledgedBatches > acknowledgement.acceptedBatches
  ) {
    return null;
  }

  return acknowledgement.acknowledgedBatches / acknowledgement.acceptedBatches;
}

function acknowledgementRatios(
  acknowledgements: SignalPromotionAcknowledgements | undefined,
): SignalPromotionAcknowledgementRatios {
  return {
    overall: acknowledgementRatio(acknowledgements?.overall),
    span: acknowledgementRatio(acknowledgements?.span),
    metricBucket: acknowledgementRatio(acknowledgements?.metricBucket),
    applicationLog: acknowledgementRatio(acknowledgements?.applicationLog),
    accessLog: acknowledgementRatio(acknowledgements?.accessLog),
  };
}

function isQualifiedRatio(value: number | null): boolean {
  return value !== null && value >= MINIMUM_ACKNOWLEDGEMENT_RATIO;
}

function hasCompletedShadowDays(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= MINIMUM_SHADOW_DAYS
  );
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function hasHumanApproval(
  approval: SignalPromotionHumanApproval | undefined,
  evaluatedAt: string,
): boolean {
  const approvedAt = parseTimestamp(approval?.approvedAt);
  const evaluated = parseTimestamp(evaluatedAt);
  return (
    approval?.approved === true &&
    typeof approval.actorId === 'string' &&
    approval.actorId.trim().length > 0 &&
    approvedAt !== null &&
    evaluated !== null &&
    approvedAt <= evaluated
  );
}

function hasRollbackWindow(
  rollbackWindow: SignalPromotionRollbackWindow | undefined,
  evaluatedAt: string,
): boolean {
  if (rollbackWindow?.postgresShadowAvailable !== true) return false;

  const startsAt = parseTimestamp(rollbackWindow.startsAt);
  const endsAt = parseTimestamp(rollbackWindow.endsAt);
  const evaluated = parseTimestamp(evaluatedAt);
  if (startsAt === null || endsAt === null || evaluated === null) return false;

  return (
    startsAt <= evaluated &&
    evaluated <= endsAt &&
    endsAt - startsAt >= MINIMUM_ROLLBACK_WINDOW_MS
  );
}

/**
 * Evaluates only the two forward production promotions defined by the spec.
 * Every decision is derived solely from the supplied evidence.
 */
export function evaluateSignalPromotion(
  input: SignalPromotionInput,
): SignalPromotionDecision {
  const kind = isReaderPromotion(input)
    ? 'reader'
    : isWriterPromotion(input)
      ? 'writer'
      : 'invalid';
  const ratios = acknowledgementRatios(input.evidence?.acknowledgements);

  if (kind === 'invalid') {
    return {
      kind,
      allowed: false,
      failures: ['invalid_transition'],
      acknowledgementRatios: ratios,
    };
  }

  const failures: SignalPromotionFailureCode[] = [];
  if (
    kind === 'reader' &&
    !hasCompletedShadowDays(input.evidence?.consecutiveDualWriteDays)
  ) {
    failures.push('dual_write_shadow_incomplete');
  }
  if (
    kind === 'writer' &&
    !hasCompletedShadowDays(input.evidence?.consecutivePostgresShadowDays)
  ) {
    failures.push('postgres_shadow_incomplete');
  }

  if (!isQualifiedRatio(ratios.overall)) {
    failures.push('overall_acknowledgement_ratio_insufficient');
  }
  if (
    !isQualifiedRatio(ratios.span) ||
    !isQualifiedRatio(ratios.metricBucket) ||
    !isQualifiedRatio(ratios.applicationLog) ||
    !isQualifiedRatio(ratios.accessLog)
  ) {
    failures.push('per_signal_acknowledgement_ratio_insufficient');
  }

  const parity = input.evidence?.parity;
  if (parity?.backfillCompleted !== true) {
    failures.push('backfill_incomplete');
  }
  if (parity?.latestIdentityCountsMatch !== true) {
    failures.push('latest_identity_count_mismatch');
  }
  if (parity?.deterministicSampleChecksumsMatch !== true) {
    failures.push('deterministic_sample_checksum_mismatch');
  }
  if (parity?.queryParityPassed !== true) {
    failures.push('query_parity_failed');
  }

  const gates = input.evidence?.gates;
  if (gates?.ingestSloGreen !== true) failures.push('ingest_slo_not_green');
  if (gates?.querySloGreen !== true) failures.push('query_slo_not_green');
  if (gates?.capacityQualified !== true) {
    failures.push('capacity_not_qualified');
  }
  if (gates?.diskHeadroomSatisfied !== true) {
    failures.push('disk_headroom_insufficient');
  }
  if (gates?.schemaHealthy !== true) failures.push('schema_not_healthy');
  if (gates?.securityClear !== true) failures.push('security_gate_not_clear');
  if (gates?.availabilityHealthy !== true) {
    failures.push('availability_not_healthy');
  }

  if (!hasHumanApproval(input.evidence?.humanApproval, input.evaluatedAt)) {
    failures.push('human_approval_missing');
  }
  if (!hasRollbackWindow(input.evidence?.rollbackWindow, input.evaluatedAt)) {
    failures.push('rollback_window_invalid');
  }

  return {
    kind,
    allowed: failures.length === 0,
    failures,
    acknowledgementRatios: ratios,
  };
}

/**
 * Describes the data consequence of a rollback request without changing any
 * configuration. A writer cutover always makes PostgreSQL incomplete from the
 * recorded cutover instant onward.
 */
export function classifySignalRollback(
  input: SignalRollbackInput,
): SignalRollbackClassification {
  if (input.current.readMode === 'postgres') {
    return {
      kind: 'already_on_postgres_reader',
      target: null,
      blindSpotSince: null,
    };
  }

  if (input.current.writeMode === 'clickhouse') {
    return {
      kind: 'writer_cutover_blind_spot',
      target: { writeMode: 'dual', readMode: 'postgres' },
      blindSpotSince:
        parseTimestamp(input.writerCutoverAt) === null
          ? null
          : input.writerCutoverAt,
    };
  }

  const requestedAt = parseTimestamp(input.rollbackRequestedAt);
  const postgresShadowUntil = parseTimestamp(input.postgresShadowUntil);
  if (
    input.current.writeMode === 'dual' &&
    requestedAt !== null &&
    postgresShadowUntil !== null &&
    requestedAt < postgresShadowUntil
  ) {
    return {
      kind: 'safe_shadow_rollback',
      target: { writeMode: 'dual', readMode: 'postgres' },
      blindSpotSince: null,
    };
  }

  return {
    kind: 'rollback_window_expired',
    target: null,
    blindSpotSince: null,
  };
}
