import { describe, expect, test } from 'bun:test';
import type { DatabaseClient } from '#project/database';
import type { SignalPromotionInput } from './promotion';
import { PostgresSignalPromotionControl } from './promotion-control-postgres';

const INPUT: SignalPromotionInput = {
  from: { writeMode: 'dual', readMode: 'postgres' },
  to: { writeMode: 'dual', readMode: 'clickhouse' },
  evaluatedAt: '2026-08-26T12:00:00.000Z',
  evidence: {
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
  },
};

interface Query {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function fakeDatabase(responses: unknown[][]): {
  readonly database: DatabaseClient;
  readonly queries: Query[];
} {
  const queries: Query[] = [];
  const database = {
    unsafe: async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
      queries.push({ sql, params });
      return responses.shift() ?? [];
    },
    begin: async <T>(
      operation: (transaction: DatabaseClient) => Promise<T>,
    ): Promise<T> => operation(database as unknown as DatabaseClient),
  } as unknown as DatabaseClient;
  return {
    database,
    queries,
  };
}

function reportRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    report_id: '01812345-6789-7abc-8def-0123456789ab',
    from_write_mode: INPUT.from.writeMode,
    from_read_mode: INPUT.from.readMode,
    to_write_mode: INPUT.to.writeMode,
    to_read_mode: INPUT.to.readMode,
    evaluated_at: new Date(INPUT.evaluatedAt),
    evidence: JSON.stringify(INPUT.evidence),
    decision: JSON.stringify({ allowed: true }),
    artifact_uri: 'https://ci.example.test/runs/1',
    recorded_by: 'operator-1',
    recorded_at: new Date(INPUT.evaluatedAt),
    ...overrides,
  };
}

function activationRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    activation_id: '01812345-6789-7abc-8def-0123456789ac',
    activation_kind: 'forward',
    from_write_mode: 'dual',
    from_read_mode: 'postgres',
    to_write_mode: 'dual',
    to_read_mode: 'clickhouse',
    report_id: '01812345-6789-7abc-8def-0123456789ab',
    activated_by: 'operator-1',
    activated_at: new Date(INPUT.evaluatedAt),
    ...overrides,
  };
}

function promotionControl(
  database: DatabaseClient,
): PostgresSignalPromotionControl {
  return new PostgresSignalPromotionControl({
    controlDatabase: database,
    now: () => new Date(INPUT.evaluatedAt),
  });
}

describe('PostgresSignalPromotionControl', () => {
  test('records immutable evidence with the recomputed promotion decision', async () => {
    const fake = fakeDatabase([[reportRow()]]);
    const control = promotionControl(fake.database);

    await expect(
      control.record({
        ...INPUT,
        artifactUri: 'https://ci.example.test/runs/1',
        recordedBy: 'operator-1',
      }),
    ).resolves.toMatchObject({
      reportId: '01812345-6789-7abc-8def-0123456789ab',
      decision: { allowed: true },
    });
    expect(fake.queries[0]?.sql).toContain(
      'INSERT INTO telemetry.signal_promotion_reports',
    );
    expect(fake.queries[0]?.params.slice(0, 5)).toEqual([
      'dual',
      'postgres',
      'dual',
      'clickhouse',
      INPUT.evaluatedAt,
    ]);
  });

  test('permits only a durable report that still recomputes as approved for the configured target', async () => {
    const fake = fakeDatabase([[reportRow()]]);
    const control = promotionControl(fake.database);

    await expect(
      control.allowsPromotion('01812345-6789-7abc-8def-0123456789ab', INPUT.to),
    ).resolves.toBe(true);
    expect(fake.queries[0]?.sql).toContain(
      'FROM telemetry.signal_promotion_reports',
    );
  });

  test('fails closed when a formerly approved report has an expired rollback window', async () => {
    const fake = fakeDatabase([[reportRow()]]);
    const control = new PostgresSignalPromotionControl({
      controlDatabase: fake.database,
      now: () => new Date('2026-09-03T12:00:00.000Z'),
    });

    await expect(
      control.allowsPromotion('01812345-6789-7abc-8def-0123456789ab', INPUT.to),
    ).resolves.toBe(false);
  });

  test('fails closed for a mismatched target or tampered decision', async () => {
    const mismatch = fakeDatabase([[reportRow()]]);
    const mismatchControl = promotionControl(mismatch.database);
    await expect(
      mismatchControl.allowsPromotion('01812345-6789-7abc-8def-0123456789ab', {
        writeMode: 'clickhouse',
        readMode: 'clickhouse',
      }),
    ).resolves.toBe(false);

    const tampered = fakeDatabase([
      [reportRow({ decision: '{"allowed":false}' })],
    ]);
    const tamperedControl = promotionControl(tampered.database);
    await expect(
      tamperedControl.allowsPromotion(
        '01812345-6789-7abc-8def-0123456789ab',
        INPUT.to,
      ),
    ).resolves.toBe(false);
  });

  test('allows only the current activation with its exact configured report ID', async () => {
    const matching = fakeDatabase([[activationRow()]]);
    const matchingControl = promotionControl(matching.database);
    await expect(
      matchingControl.allowsActivatedStorageMode(
        INPUT.to,
        '01812345-6789-7abc-8def-0123456789ab',
      ),
    ).resolves.toBe(true);

    const replay = fakeDatabase([
      [
        activationRow({
          report_id: '01812345-6789-7abc-8def-0123456789ad',
        }),
      ],
    ]);
    const replayControl = promotionControl(replay.database);
    await expect(
      replayControl.allowsActivatedStorageMode(
        INPUT.to,
        '01812345-6789-7abc-8def-0123456789ab',
      ),
    ).resolves.toBe(false);
  });

  test('activates the next approved state under a Control transaction', async () => {
    const fake = fakeDatabase([
      [],
      [
        activationRow({
          activation_kind: 'forward',
          from_write_mode: 'postgres',
          from_read_mode: 'postgres',
          to_write_mode: 'dual',
          to_read_mode: 'postgres',
          report_id: null,
        }),
      ],
      [reportRow()],
      [activationRow()],
    ]);
    const control = promotionControl(fake.database);

    await expect(
      control.activate({
        from: INPUT.from,
        to: INPUT.to,
        reportId: '01812345-6789-7abc-8def-0123456789ab',
        activatedBy: 'operator-1',
      }),
    ).resolves.toMatchObject({
      kind: 'forward',
      from: INPUT.from,
      to: INPUT.to,
      reportId: '01812345-6789-7abc-8def-0123456789ab',
    });

    expect(fake.queries[0]?.sql).toContain('pg_advisory_xact_lock');
    expect(fake.queries[1]?.sql).toContain(
      'FROM telemetry.signal_storage_activations',
    );
    expect(fake.queries[2]?.sql).toContain(
      'FROM telemetry.signal_promotion_reports',
    );
    expect(fake.queries[3]?.sql).toContain(
      'INSERT INTO telemetry.signal_storage_activations',
    );
  });

  test('rejects a report activation that skips the durable current mode', async () => {
    const fake = fakeDatabase([
      [],
      [
        activationRow({
          activation_kind: 'initial',
          from_write_mode: 'postgres',
          from_read_mode: 'postgres',
          to_write_mode: 'postgres',
          to_read_mode: 'postgres',
          report_id: null,
        }),
      ],
    ]);
    const control = promotionControl(fake.database);

    await expect(
      control.activate({
        from: INPUT.from,
        to: INPUT.to,
        reportId: '01812345-6789-7abc-8def-0123456789ab',
        activatedBy: 'operator-1',
      }),
    ).rejects.toThrow('requires current mode dual/postgres');
    expect(fake.queries).toHaveLength(2);
  });

  test('records the writer cutover instant as a durable Blind Spot on rollback', async () => {
    const fake = fakeDatabase([
      [],
      [
        activationRow({
          from_write_mode: 'dual',
          from_read_mode: 'clickhouse',
          to_write_mode: 'clickhouse',
          to_read_mode: 'clickhouse',
          report_id: '01812345-6789-7abc-8def-0123456789ab',
        }),
      ],
      [
        activationRow({
          activation_kind: 'rollback',
          from_write_mode: 'clickhouse',
          from_read_mode: 'clickhouse',
          to_write_mode: 'dual',
          to_read_mode: 'postgres',
          report_id: null,
          blind_spot_since: new Date(INPUT.evaluatedAt),
        }),
      ],
    ]);
    const control = promotionControl(fake.database);

    await expect(
      control.activate({
        from: { writeMode: 'clickhouse', readMode: 'clickhouse' },
        to: { writeMode: 'dual', readMode: 'postgres' },
        reportId: null,
        activatedBy: 'operator-1',
      }),
    ).resolves.toMatchObject({
      kind: 'rollback',
      blindSpotSince: INPUT.evaluatedAt,
    });
    expect(fake.queries[2]?.params?.at(-1)).toBe(INPUT.evaluatedAt);
  });
});
