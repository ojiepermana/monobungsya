import { describe, expect, test } from 'bun:test';
import type { DatabaseClient } from '#project/database';
import type { SignalPromotionEvidence } from '#project/observability';
import {
  activatePromotionFromCommand,
  type PromotionActivationDependencies,
  parsePromotionActivationCommand,
} from './activate-observability-promotion';

const REPORT_ID = '01812345-6789-7abc-8def-0123456789ab';
const ACTIVATION_ID = '01812345-6789-7abc-8def-0123456789ac';
const NOW = new Date('2026-08-26T12:00:00.000Z');
const ARGUMENTS = [
  '--from-write-mode',
  'dual',
  '--from-read-mode',
  'postgres',
  '--to-write-mode',
  'dual',
  '--to-read-mode',
  'clickhouse',
  '--report-id',
  REPORT_ID,
  '--actor-id',
  'operator-42',
] as const;

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
  return { database, queries };
}

function reportRow(): Record<string, unknown> {
  return {
    report_id: REPORT_ID,
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
  };
}

function activationRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    activation_id: ACTIVATION_ID,
    activation_kind: 'forward',
    from_write_mode: 'dual',
    from_read_mode: 'postgres',
    to_write_mode: 'dual',
    to_read_mode: 'clickhouse',
    report_id: REPORT_ID,
    activated_by: 'operator-42',
    activated_at: NOW,
    ...overrides,
  };
}

function dependencies(
  database: DatabaseClient,
  overrides: Partial<PromotionActivationDependencies> = {},
): PromotionActivationDependencies {
  return {
    createDatabaseClient: () => database,
    closeDatabaseClient: async () => {},
    write: () => {},
    ...overrides,
  };
}

describe('observability promotion activation command', () => {
  test('parses an explicit activation and rejects malformed report IDs', () => {
    expect(parsePromotionActivationCommand(ARGUMENTS)).toEqual({
      from: { writeMode: 'dual', readMode: 'postgres' },
      to: { writeMode: 'dual', readMode: 'clickhouse' },
      reportId: REPORT_ID,
      activatedBy: 'operator-42',
    });
    expect(() =>
      parsePromotionActivationCommand([
        ...ARGUMENTS.slice(0, 9),
        'not-a-uuid',
        ...ARGUMENTS.slice(10),
      ]),
    ).toThrow('--report-id must be a UUID');
    expect(() =>
      parsePromotionActivationCommand(ARGUMENTS.slice(0, -2)),
    ).toThrow('Missing required argument: --actor-id');
  });

  test('activates only the next approved state and emits safe evidence', async () => {
    const fake = fakeDatabase([
      [],
      [
        activationRow({
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
    const output: string[] = [];
    let closed = 0;

    await expect(
      activatePromotionFromCommand(
        ARGUMENTS,
        { OBSERVABILITY_DATABASE_URL: 'postgres://operator@localhost/control' },
        dependencies(fake.database, {
          closeDatabaseClient: async () => {
            closed += 1;
          },
          now: () => NOW,
          write: (line) => output.push(line),
        }),
      ),
    ).resolves.toMatchObject({
      activationId: ACTIVATION_ID,
      to: { writeMode: 'dual', readMode: 'clickhouse' },
      reportId: REPORT_ID,
    });

    expect(fake.queries[0]?.sql).toContain('pg_advisory_xact_lock');
    expect(fake.queries[3]?.sql).toContain(
      'INSERT INTO telemetry.signal_storage_activations',
    );
    expect(closed).toBe(1);
    expect(output).toEqual([
      JSON.stringify({
        activationId: ACTIVATION_ID,
        from: { writeMode: 'dual', readMode: 'postgres' },
        to: { writeMode: 'dual', readMode: 'clickhouse' },
        reportId: REPORT_ID,
        activatedAt: NOW.toISOString(),
        blindSpotSince: null,
      }),
    ]);
  });

  test('permits the explicit baseline to dual-write activation without a report', async () => {
    const argumentsWithoutReport = [
      '--from-write-mode',
      'postgres',
      '--from-read-mode',
      'postgres',
      '--to-write-mode',
      'dual',
      '--to-read-mode',
      'postgres',
      '--actor-id',
      'operator-42',
    ];
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
      [
        activationRow({
          from_write_mode: 'postgres',
          from_read_mode: 'postgres',
          to_write_mode: 'dual',
          to_read_mode: 'postgres',
          report_id: null,
        }),
      ],
    ]);

    await expect(
      activatePromotionFromCommand(
        argumentsWithoutReport,
        { OBSERVABILITY_DATABASE_URL: 'postgres://operator@localhost/control' },
        dependencies(fake.database),
      ),
    ).resolves.toMatchObject({
      from: { writeMode: 'postgres', readMode: 'postgres' },
      to: { writeMode: 'dual', readMode: 'postgres' },
      reportId: null,
    });
    expect(fake.queries).toHaveLength(3);
  });
});
