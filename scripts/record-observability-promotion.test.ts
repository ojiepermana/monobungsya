import { describe, expect, test } from 'bun:test';
import type { DatabaseClient } from '#project/database';
import type { SignalPromotionEvidence } from '#project/observability';
import {
  approvedPromotionRecordInput,
  observabilityControlDatabaseUrl,
  type PromotionRecordDependencies,
  parsePromotionRecordCommand,
  recordPromotionFromCommand,
} from './record-observability-promotion';

const ARGUMENTS = [
  '--from-write-mode',
  'dual',
  '--from-read-mode',
  'postgres',
  '--to-write-mode',
  'dual',
  '--to-read-mode',
  'clickhouse',
  '--evidence',
  'promotion-evidence.json',
  '--artifact-uri',
  'https://ci.example.test/runs/42',
  '--actor-id',
  'operator-42',
] as const;

const NOW = new Date('2026-08-26T12:00:00.000Z');

const EVIDENCE: SignalPromotionEvidence = {
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
    actorId: 'approver-1',
    approvedAt: '2026-08-26T11:00:00.000Z',
  },
  rollbackWindow: {
    startsAt: '2026-08-19T12:00:00.000Z',
    endsAt: '2026-08-26T12:00:00.000Z',
    postgresShadowAvailable: true,
  },
};

interface Query {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function fakeDatabase(): {
  readonly database: DatabaseClient;
  readonly queries: Query[];
} {
  const queries: Query[] = [];
  return {
    database: {
      unsafe: async (
        sql: string,
        params: unknown[] = [],
      ): Promise<unknown[]> => {
        queries.push({ sql, params });
        return [
          {
            report_id: '01812345-6789-7abc-8def-0123456789ab',
            from_write_mode: 'dual',
            from_read_mode: 'postgres',
            to_write_mode: 'dual',
            to_read_mode: 'clickhouse',
            evaluated_at: NOW,
            evidence: JSON.stringify(EVIDENCE),
            decision: JSON.stringify({ allowed: true }),
            artifact_uri: 'https://ci.example.test/runs/42',
            recorded_by: 'operator-42',
            recorded_at: NOW,
          },
        ];
      },
    } as unknown as DatabaseClient,
    queries,
  };
}

function dependencies(
  database: DatabaseClient,
  overrides: Partial<PromotionRecordDependencies> = {},
): PromotionRecordDependencies {
  return {
    createDatabaseClient: () => database,
    closeDatabaseClient: async () => {},
    readEvidence: async () => EVIDENCE,
    now: () => NOW,
    write: () => {},
    ...overrides,
  };
}

describe('observability promotion record command', () => {
  test('requires all explicit, valid operator inputs', () => {
    expect(parsePromotionRecordCommand(ARGUMENTS)).toEqual({
      from: { writeMode: 'dual', readMode: 'postgres' },
      to: { writeMode: 'dual', readMode: 'clickhouse' },
      evidencePath: 'promotion-evidence.json',
      artifactUri: 'https://ci.example.test/runs/42',
      actorId: 'operator-42',
    });
    expect(() => parsePromotionRecordCommand(ARGUMENTS.slice(0, -2))).toThrow(
      'Missing required argument: --actor-id',
    );
    expect(() =>
      parsePromotionRecordCommand([
        ...ARGUMENTS.slice(0, 1),
        'postgresql',
        ...ARGUMENTS.slice(2),
      ]),
    ).toThrow('--from-write-mode must be one of');
    expect(() =>
      parsePromotionRecordCommand([
        ...ARGUMENTS.slice(0, 11),
        'not a uri',
        ...ARGUMENTS.slice(12),
      ]),
    ).toThrow('--artifact-uri must be an absolute URI');
  });

  test('requires the dedicated observability Control database URL', () => {
    expect(
      observabilityControlDatabaseUrl({
        OBSERVABILITY_DATABASE_URL: 'postgres://operator@localhost/control',
      }),
    ).toBe('postgres://operator@localhost/control');
    expect(() => observabilityControlDatabaseUrl({})).toThrow(
      'OBSERVABILITY_DATABASE_URL is required',
    );
    expect(() =>
      observabilityControlDatabaseUrl({
        OBSERVABILITY_DATABASE_URL: 'https://control.example.test',
      }),
    ).toThrow('OBSERVABILITY_DATABASE_URL must be a PostgreSQL URL');
  });

  test('rejects an unapproved evidence report before opening a database connection', async () => {
    const command = parsePromotionRecordCommand(ARGUMENTS);
    expect(() =>
      approvedPromotionRecordInput(
        command,
        {
          ...EVIDENCE,
          parity: { ...EVIDENCE.parity, backfillCompleted: false },
        },
        () => NOW,
      ),
    ).toThrow('backfill_incomplete');

    let connections = 0;
    const fake = fakeDatabase();
    await expect(
      recordPromotionFromCommand(
        ARGUMENTS,
        { OBSERVABILITY_DATABASE_URL: 'postgres://operator@localhost/control' },
        dependencies(fake.database, {
          createDatabaseClient: () => {
            connections += 1;
            return fake.database;
          },
          readEvidence: async () => ({
            ...EVIDENCE,
            gates: { ...EVIDENCE.gates, securityClear: false },
          }),
        }),
      ),
    ).rejects.toThrow('security_gate_not_clear');
    expect(connections).toBe(0);
  });

  test('records an approved report with the control database and closes it', async () => {
    const fake = fakeDatabase();
    let closed = 0;
    const output: string[] = [];

    await expect(
      recordPromotionFromCommand(
        ARGUMENTS,
        { OBSERVABILITY_DATABASE_URL: 'postgres://operator@localhost/control' },
        dependencies(fake.database, {
          closeDatabaseClient: async () => {
            closed += 1;
          },
          write: (line) => output.push(line),
        }),
      ),
    ).resolves.toMatchObject({
      reportId: '01812345-6789-7abc-8def-0123456789ab',
      decision: { allowed: true },
    });

    expect(fake.queries).toHaveLength(1);
    expect(fake.queries[0]?.sql).toContain(
      'INSERT INTO telemetry.signal_promotion_reports',
    );
    expect(fake.queries[0]?.params.slice(0, 5)).toEqual([
      'dual',
      'postgres',
      'dual',
      'clickhouse',
      NOW.toISOString(),
    ]);
    expect(closed).toBe(1);
    expect(output).toEqual([
      JSON.stringify({
        reportId: '01812345-6789-7abc-8def-0123456789ab',
        from: { writeMode: 'dual', readMode: 'postgres' },
        to: { writeMode: 'dual', readMode: 'clickhouse' },
        recordedAt: NOW.toISOString(),
      }),
    ]);
  });
});
