import { describe, expect, test } from 'bun:test';
import type { AppEnvironment } from '#project/config';
import type { DatabaseClient } from '#project/database';
import type { SignalPromotionEvidence } from './promotion';
import {
  createRuntimeClickHouseSignalReader,
  createRuntimeObservabilitySignalStore,
} from './runtime';

const APPROVED_EVIDENCE: SignalPromotionEvidence = {
  consecutiveDualWriteDays: 7,
  consecutivePostgresShadowDays: 0,
  acknowledgements: {
    overall: { acceptedBatches: 10_000, acknowledgedBatches: 9_990 },
    span: { acceptedBatches: 2_500, acknowledgedBatches: 2_498 },
    metricBucket: { acceptedBatches: 2_500, acknowledgedBatches: 2_498 },
    applicationLog: { acceptedBatches: 2_500, acknowledgedBatches: 2_498 },
    accessLog: { acceptedBatches: 2_500, acknowledgedBatches: 2_498 },
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
    approvedAt: '2026-08-26T11:00:00.000Z',
  },
  rollbackWindow: {
    startsAt: '2026-08-19T12:00:00.000Z',
    endsAt: '2026-08-26T12:00:00.000Z',
    postgresShadowAvailable: true,
  },
};

function approvedControlDatabase(onQuery: () => void): DatabaseClient {
  return {
    unsafe: async (sql: string) => {
      onQuery();
      if (sql.includes('telemetry.signal_storage_activations')) {
        return [
          {
            activation_id: '01812345-6789-7abc-8def-0123456789ac',
            activation_kind: 'forward',
            from_write_mode: 'dual',
            from_read_mode: 'postgres',
            to_write_mode: 'dual',
            to_read_mode: 'clickhouse',
            report_id: '01812345-6789-7abc-8def-0123456789ab',
            activated_by: 'operator-1',
            activated_at: new Date('2026-08-26T12:00:00.000Z'),
          },
        ];
      }
      return [
        {
          report_id: '01812345-6789-7abc-8def-0123456789ab',
          from_write_mode: 'dual',
          from_read_mode: 'postgres',
          to_write_mode: 'dual',
          to_read_mode: 'clickhouse',
          evaluated_at: new Date('2026-08-26T12:00:00.000Z'),
          evidence: JSON.stringify(APPROVED_EVIDENCE),
          decision: JSON.stringify({ allowed: true }),
          artifact_uri: 'https://ci.example.test/runs/1',
          recorded_by: 'operator-1',
          recorded_at: new Date('2026-08-26T12:00:00.000Z'),
        },
      ];
    },
  } as unknown as DatabaseClient;
}

function productionCutoverEnvironment(): AppEnvironment {
  return {
    NODE_ENV: 'production',
    OBSERVABILITY_SIGNAL_WRITE_MODE: 'dual',
    OBSERVABILITY_SIGNAL_READ_MODE: 'clickhouse',
    OBSERVABILITY_SIGNAL_PROMOTION_REPORT_ID:
      '01812345-6789-7abc-8def-0123456789ab',
  } as AppEnvironment;
}

describe('runtime Signal promotion gate', () => {
  test('fails closed for a production writer cutover without an approved PostgreSQL Control report', async () => {
    const store = await createRuntimeObservabilitySignalStore({
      environment: productionCutoverEnvironment(),
      promotionControl: {
        allowsPromotion: async () => false,
        allowsActivatedStorageMode: async () => false,
      },
    });

    expect(store.diagnostics()).toMatchObject({
      state: 'disabled',
      failureCode: 'clickhouse_promotion_unapproved',
    });
  });

  test('does not construct a public ClickHouse reader without the same approved cutover report', async () => {
    const configured = await createRuntimeClickHouseSignalReader(
      productionCutoverEnvironment(),
      {
        promotionControl: {
          allowsPromotion: async () => false,
          allowsActivatedStorageMode: async () => false,
        },
      },
    );

    expect(configured).toMatchObject({
      reader: null,
      readiness: {
        available: false,
        failureCode: 'clickhouse_promotion_unapproved',
      },
    });
  });

  test('uses the explicit Control database for writer promotion instead of the telemetry store', async () => {
    let controlQueries = 0;
    let telemetryQueries = 0;
    const store = await createRuntimeObservabilitySignalStore({
      environment: productionCutoverEnvironment(),
      now: () => new Date('2026-08-26T12:00:00.000Z'),
      controlDatabase: approvedControlDatabase(() => {
        controlQueries += 1;
      }),
      telemetryDatabase: {
        unsafe: async () => {
          telemetryQueries += 1;
          throw new Error('the telemetry store must not authorize promotion');
        },
      } as unknown as DatabaseClient,
    });

    expect(controlQueries).toBe(2);
    expect(telemetryQueries).toBe(0);
    expect(store.diagnostics().failureCode).not.toBe(
      'clickhouse_promotion_unapproved',
    );
    await store.shutdown();
  });

  test('fails closed instead of treating the telemetry store as a Control fallback', async () => {
    let telemetryQueries = 0;
    const store = await createRuntimeObservabilitySignalStore({
      environment: productionCutoverEnvironment(),
      telemetryDatabase: approvedControlDatabase(() => {
        telemetryQueries += 1;
      }),
    });

    expect(telemetryQueries).toBe(0);
    expect(store.diagnostics()).toMatchObject({
      state: 'disabled',
      failureCode: 'clickhouse_promotion_unapproved',
    });
    await store.shutdown();
  });

  test('requires an active Control activation before production dual write', async () => {
    const environment = productionCutoverEnvironment();
    environment.OBSERVABILITY_SIGNAL_READ_MODE = 'postgres';
    const store = await createRuntimeObservabilitySignalStore({
      environment,
      promotionControl: {
        allowsPromotion: async () => {
          throw new Error('dual write must not use a promotion report');
        },
        allowsActivatedStorageMode: async () => false,
      },
    });

    expect(store.diagnostics()).toMatchObject({
      state: 'disabled',
      failureCode: 'clickhouse_promotion_unapproved',
    });
    await store.shutdown();
  });

  test('keeps development ClickHouse setup outside the production promotion workflow', async () => {
    const environment = productionCutoverEnvironment();
    environment.NODE_ENV = 'test';
    const store = await createRuntimeObservabilitySignalStore({
      environment,
      promotionControl: {
        allowsPromotion: async () => {
          throw new Error('development must not query Control');
        },
        allowsActivatedStorageMode: async () => {
          throw new Error('development must not query Control');
        },
      },
    });

    expect(store.diagnostics().failureCode).not.toBe(
      'clickhouse_promotion_unapproved',
    );
    await store.shutdown();
  });
});
