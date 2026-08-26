import { describe, expect, test } from 'bun:test';
import {
  classifySignalRollback,
  evaluateSignalPromotion,
  type SignalBatchAcknowledgement,
  type SignalPromotionEvidence,
  type SignalPromotionInput,
} from './promotion';

const EVALUATED_AT = '2026-08-26T12:00:00.000Z';
const ROLLBACK_START = '2026-08-26T12:00:00.000Z';
const ROLLBACK_END = '2026-09-02T12:00:00.000Z';

function acknowledgement(
  acceptedBatches = 1_000,
  acknowledgedBatches = 999,
): SignalBatchAcknowledgement {
  return { acceptedBatches, acknowledgedBatches };
}

function promotionEvidence(
  overrides: Partial<SignalPromotionEvidence> = {},
): SignalPromotionEvidence {
  return {
    consecutiveDualWriteDays: 7,
    consecutivePostgresShadowDays: 7,
    acknowledgements: {
      overall: acknowledgement(),
      span: acknowledgement(),
      metricBucket: acknowledgement(),
      applicationLog: acknowledgement(),
      accessLog: acknowledgement(),
    },
    parity: {
      backfillCompleted: true,
      latestIdentityCountsMatch: true,
      deterministicSampleChecksumsMatch: true,
      queryParityPassed: true,
    },
    gates: {
      ingestSloGreen: true,
      querySloGreen: true,
      capacityQualified: true,
      diskHeadroomSatisfied: true,
      schemaHealthy: true,
      securityClear: true,
      availabilityHealthy: true,
    },
    humanApproval: {
      approved: true,
      actorId: 'operator-1',
      approvedAt: EVALUATED_AT,
    },
    rollbackWindow: {
      startsAt: ROLLBACK_START,
      endsAt: ROLLBACK_END,
      postgresShadowAvailable: true,
    },
    ...overrides,
  };
}

function readerPromotion(
  evidence: SignalPromotionEvidence = promotionEvidence(),
): SignalPromotionInput {
  return {
    from: { writeMode: 'dual', readMode: 'postgres' },
    to: { writeMode: 'dual', readMode: 'clickhouse' },
    evaluatedAt: EVALUATED_AT,
    evidence,
  };
}

function writerPromotion(
  evidence: SignalPromotionEvidence = promotionEvidence(),
): SignalPromotionInput {
  return {
    from: { writeMode: 'dual', readMode: 'clickhouse' },
    to: { writeMode: 'clickhouse', readMode: 'clickhouse' },
    evaluatedAt: ROLLBACK_END,
    evidence,
  };
}

describe('evaluateSignalPromotion', () => {
  test('allows reader promotion only with explicit passing evidence', () => {
    expect(evaluateSignalPromotion(readerPromotion())).toEqual({
      kind: 'reader',
      allowed: true,
      failures: [],
      acknowledgementRatios: {
        overall: 0.999,
        span: 0.999,
        metricBucket: 0.999,
        applicationLog: 0.999,
        accessLog: 0.999,
      },
    });
  });

  test('requires a new seven day PostgreSQL shadow before writer promotion', () => {
    const evidence = promotionEvidence({ consecutivePostgresShadowDays: 6 });

    expect(evaluateSignalPromotion(writerPromotion(evidence))).toMatchObject({
      kind: 'writer',
      allowed: false,
      failures: ['postgres_shadow_incomplete'],
    });
  });

  test('allows writer promotion after the completed PostgreSQL shadow', () => {
    expect(evaluateSignalPromotion(writerPromotion())).toMatchObject({
      kind: 'writer',
      allowed: true,
      failures: [],
    });
  });

  test('rejects reader promotion when every material evidence group is missing or failed', () => {
    const evidence = promotionEvidence({
      consecutiveDualWriteDays: 6,
      acknowledgements: {
        overall: acknowledgement(1_000, 998),
        span: acknowledgement(1_000, 998),
        metricBucket: acknowledgement(1_000, 998),
        applicationLog: acknowledgement(1_000, 998),
        accessLog: acknowledgement(1_000, 998),
      },
      parity: {
        backfillCompleted: false,
        latestIdentityCountsMatch: false,
        deterministicSampleChecksumsMatch: false,
        queryParityPassed: false,
      },
      gates: {
        ingestSloGreen: false,
        querySloGreen: false,
        capacityQualified: false,
        diskHeadroomSatisfied: false,
        schemaHealthy: false,
        securityClear: false,
        availabilityHealthy: false,
      },
      humanApproval: {
        approved: false,
        actorId: null,
        approvedAt: null,
      },
      rollbackWindow: {
        startsAt: null,
        endsAt: null,
        postgresShadowAvailable: false,
      },
    });

    expect(evaluateSignalPromotion(readerPromotion(evidence))).toMatchObject({
      allowed: false,
      failures: [
        'dual_write_shadow_incomplete',
        'overall_acknowledgement_ratio_insufficient',
        'per_signal_acknowledgement_ratio_insufficient',
        'backfill_incomplete',
        'latest_identity_count_mismatch',
        'deterministic_sample_checksum_mismatch',
        'query_parity_failed',
        'ingest_slo_not_green',
        'query_slo_not_green',
        'capacity_not_qualified',
        'disk_headroom_insufficient',
        'schema_not_healthy',
        'security_gate_not_clear',
        'availability_not_healthy',
        'human_approval_missing',
        'rollback_window_invalid',
      ],
    });
  });

  test('rejects unsupported direct storage transitions', () => {
    const input = {
      ...readerPromotion(),
      to: { writeMode: 'clickhouse' as const, readMode: 'clickhouse' as const },
    };

    expect(evaluateSignalPromotion(input)).toMatchObject({
      kind: 'invalid',
      allowed: false,
      failures: ['invalid_transition'],
    });
  });
});

describe('classifySignalRollback', () => {
  test('classifies a reader rollback during PostgreSQL shadow as safe', () => {
    expect(
      classifySignalRollback({
        current: { writeMode: 'dual', readMode: 'clickhouse' },
        rollbackRequestedAt: EVALUATED_AT,
        postgresShadowUntil: ROLLBACK_END,
        writerCutoverAt: null,
      }),
    ).toEqual({
      kind: 'safe_shadow_rollback',
      target: { writeMode: 'dual', readMode: 'postgres' },
      blindSpotSince: null,
    });
  });

  test('classifies a rollback after writer cutover as a Blind Spot', () => {
    expect(
      classifySignalRollback({
        current: { writeMode: 'clickhouse', readMode: 'clickhouse' },
        rollbackRequestedAt: '2026-09-03T12:00:00.000Z',
        postgresShadowUntil: null,
        writerCutoverAt: '2026-09-02T12:00:00.000Z',
      }),
    ).toEqual({
      kind: 'writer_cutover_blind_spot',
      target: { writeMode: 'dual', readMode: 'postgres' },
      blindSpotSince: '2026-09-02T12:00:00.000Z',
    });
  });

  test('does not label an expired shadow as a safe rollback', () => {
    expect(
      classifySignalRollback({
        current: { writeMode: 'dual', readMode: 'clickhouse' },
        rollbackRequestedAt: '2026-09-02T12:00:00.000Z',
        postgresShadowUntil: '2026-09-02T12:00:00.000Z',
        writerCutoverAt: null,
      }),
    ).toEqual({
      kind: 'rollback_window_expired',
      target: null,
      blindSpotSince: null,
    });
  });
});
