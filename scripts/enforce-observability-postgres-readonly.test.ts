import { describe, expect, test } from 'bun:test';
import type { DatabaseClient } from '#project/database';
import {
  enforceLegacySignalWritePolicy,
  type LegacySignalWritePolicyDependencies,
  parseLegacySignalWritePolicyCommand,
} from './enforce-observability-postgres-readonly';

const ACTIVATION_ID = '01812345-6789-7abc-8def-0123456789ab';
const ACTIVATED_AT = new Date('2026-08-26T12:00:00.000Z');

interface Query {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function fakeDatabase(
  responses: unknown[][],
  session = migratorSessionRow(),
): {
  readonly database: DatabaseClient;
  readonly queries: Query[];
} {
  const queries: Query[] = [];
  const database = {
    unsafe: async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
      queries.push({ sql, params });
      if (sql.includes('SET LOCAL')) return [];
      if (sql.includes("telemetry.signal_storage_activation'")) return [];
      if (
        sql.includes('session_user AS session_role') &&
        !sql.includes('migrator_exists')
      ) {
        return [session];
      }
      return responses.shift() ?? [];
    },
    begin: async <T>(
      operation: (transaction: DatabaseClient) => Promise<T>,
    ): Promise<T> => operation(database as unknown as DatabaseClient),
  } as unknown as DatabaseClient;
  return { database, queries };
}

function migratorSessionRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    session_role: 'observability_cutover_operator',
    current_role: 'project_migrator',
    session_can_set_migrator: true,
    ...overrides,
  };
}

function roleRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    session_role: 'observability_cutover_operator',
    current_role: 'project_migrator',
    migrator_exists: true,
    logs_writer_exists: true,
    telemetry_writer_exists: true,
    migrator_can_manage_logs_writer: true,
    migrator_can_write_audit: true,
    ...overrides,
  };
}

function telemetryRelations(
  overrides: Record<string, unknown> = {},
): Record<string, unknown>[] {
  return [
    {
      schema_name: 'telemetry',
      relation_name: 'spans',
      owner: 'project_migrator',
      migrator_can_create_schema: true,
      logs_writer_can_create_schema: true,
      ...overrides,
    },
    {
      schema_name: 'telemetry',
      relation_name: 'metric_buckets',
      owner: 'project_migrator',
      migrator_can_create_schema: true,
      logs_writer_can_create_schema: true,
      ...overrides,
    },
  ];
}

function logsRelations(
  owner = 'project_logs_writer',
  overrides: Record<string, unknown> = {},
): Record<string, unknown>[] {
  return [
    {
      schema_name: 'logs',
      relation_name: 'logging',
      owner,
      migrator_can_create_schema: true,
      logs_writer_can_create_schema: true,
      ...overrides,
    },
    {
      schema_name: 'logs',
      relation_name: 'access_logs',
      owner,
      migrator_can_create_schema: true,
      logs_writer_can_create_schema: true,
      ...overrides,
    },
    {
      schema_name: 'partition',
      relation_name: 'logging_2026',
      owner,
      migrator_can_create_schema: true,
      logs_writer_can_create_schema: true,
      ...overrides,
    },
  ];
}

function lockedPostcondition(relationCount: number): Record<string, unknown> {
  return {
    relation_count: relationCount,
    owner_count: relationCount,
    writable_relation_count: 0,
    migrator_delegate_relation_count: 0,
  };
}

function activationRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    activation_id: ACTIVATION_ID,
    activation_kind: 'forward',
    from_write_mode: 'dual',
    from_read_mode: 'clickhouse',
    to_write_mode: 'clickhouse',
    to_read_mode: 'clickhouse',
    activated_at: ACTIVATED_AT,
    blind_spot_since: null,
    ...overrides,
  };
}

function command(
  action: 'lock' | 'unlock' = 'lock',
  extra: readonly string[] = [],
): readonly string[] {
  return [
    '--action',
    action,
    '--activation-id',
    ACTIVATION_ID,
    '--actor-id',
    'operator-42',
    '--reason',
    'Approved migration window',
    '--confirm',
    `${action}:${ACTIVATION_ID}`,
    ...extra,
  ];
}

function environment(): Record<string, string> {
  return {
    OBSERVABILITY_DATABASE_URL: 'postgres://operator@localhost/control',
    OBSERVABILITY_MIGRATION_LOGIN: 'observability_cutover_operator',
    OBSERVABILITY_TELEMETRY_MIGRATION_URL:
      'postgres://migrator@localhost/telemetry',
    OBSERVABILITY_LOGS_MIGRATION_URL: 'postgres://migrator@localhost/logs',
  };
}

function dependencies(
  databases: {
    readonly control: DatabaseClient;
    readonly telemetry: DatabaseClient;
    readonly logs: DatabaseClient;
  },
  output: string[],
  counters: { created: number; closed: number },
): LegacySignalWritePolicyDependencies {
  return {
    createDatabaseClient: (connectionString) => {
      counters.created += 1;
      if (connectionString.endsWith('/control')) return databases.control;
      if (connectionString.endsWith('/telemetry')) return databases.telemetry;
      if (connectionString.endsWith('/logs')) return databases.logs;
      throw new Error('unexpected connection string');
    },
    closeDatabaseClient: async () => {
      counters.closed += 1;
    },
    write: (line) => output.push(line),
  };
}

describe('observability PostgreSQL legacy Signal write policy', () => {
  test('requires an exact action and activation confirmation', () => {
    expect(parseLegacySignalWritePolicyCommand(command())).toEqual({
      action: 'lock',
      activationId: ACTIVATION_ID,
      actorId: 'operator-42',
      reason: 'Approved migration window',
      dryRun: false,
    });
    expect(() =>
      parseLegacySignalWritePolicyCommand([
        ...command().slice(0, -1),
        `unlock:${ACTIVATION_ID}`,
      ]),
    ).toThrow('--confirm must exactly match');
    expect(() =>
      parseLegacySignalWritePolicyCommand([
        '--action',
        'truncate',
        ...command().slice(2),
      ]),
    ).toThrow('--action must be one of');
  });

  test('locks every legacy Signal relation only after the exact writer cutover and records strict audit', async () => {
    const control = fakeDatabase([[activationRow()]]);
    const telemetry = fakeDatabase([
      [roleRow({ logs_writer_exists: false })],
      telemetryRelations(),
      [],
      [lockedPostcondition(2)],
    ]);
    const logs = fakeDatabase([
      [roleRow({ telemetry_writer_exists: false })],
      logsRelations(),
      [],
      [lockedPostcondition(3)],
      [],
    ]);
    const output: string[] = [];
    const counters = { created: 0, closed: 0 };

    await expect(
      enforceLegacySignalWritePolicy(
        command(),
        environment(),
        dependencies(
          {
            control: control.database,
            telemetry: telemetry.database,
            logs: logs.database,
          },
          output,
          counters,
        ),
      ),
    ).resolves.toEqual({
      action: 'lock',
      activationId: ACTIVATION_ID,
      activationAt: ACTIVATED_AT.toISOString(),
      readOnlyUntil: '2026-09-25T12:00:00.000Z',
      telemetryRelationCount: 2,
      logsRelationCount: 3,
      auditRecorded: true,
    });

    const telemetryLock = telemetry.queries.find((query) =>
      query.sql.includes('legacy_signal_readonly'),
    );
    const logsLock = logs.queries.find((query) =>
      query.sql.includes('legacy_signal_readonly'),
    );
    expect(telemetryLock?.sql).toContain(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER',
    );
    expect(telemetryLock?.sql).not.toContain('OWNER TO project_migrator');
    const telemetryPostcondition = telemetry.queries.find((query) =>
      query.sql.includes('migrator_delegate_relation_count'),
    );
    expect(telemetryPostcondition?.sql).toContain(
      "NOT IN ('project_migrator', $1)",
    );
    expect(logsLock?.sql).toContain('OWNER TO project_migrator');
    expect(logsLock?.sql).not.toContain('audit_trails');
    expect(logs.queries.at(-1)?.sql).toContain('INSERT INTO logs.audit_trails');
    expect(logs.queries.at(-1)?.params).toEqual([
      'signal_postgres_readonly_locked',
      ACTIVATION_ID,
      'operator-42',
      'Approved migration window',
      'Legacy PostgreSQL Signal tables were made read only after ClickHouse writer cutover.',
      JSON.stringify({
        action: 'lock',
        activationId: ACTIVATION_ID,
        activationAt: ACTIVATED_AT.toISOString(),
        readOnlyUntil: '2026-09-25T12:00:00.000Z',
        telemetryRelationCount: 2,
        logsRelationCount: 3,
        result: 'succeeded',
      }),
    ]);
    expect(output).toHaveLength(1);
    expect(counters).toEqual({ created: 3, closed: 3 });
    expect(
      control.queries.some((query) =>
        query.sql.includes("telemetry.signal_storage_activation', 0"),
      ),
    ).toBe(true);
    expect(
      [...control.queries, ...telemetry.queries, ...logs.queries].filter(
        (query) => query.sql.includes('SET LOCAL ROLE project_migrator'),
      ),
    ).toHaveLength(5);
  });

  test('does not open either source connection when Control is not at the requested writer cutover', async () => {
    const control = fakeDatabase([
      [
        activationRow({
          to_write_mode: 'dual',
          to_read_mode: 'clickhouse',
        }),
      ],
    ]);
    const telemetry = fakeDatabase([]);
    const logs = fakeDatabase([]);
    const output: string[] = [];
    const counters = { created: 0, closed: 0 };

    await expect(
      enforceLegacySignalWritePolicy(
        command(),
        environment(),
        dependencies(
          {
            control: control.database,
            telemetry: telemetry.database,
            logs: logs.database,
          },
          output,
          counters,
        ),
      ),
    ).rejects.toThrow('lock requires the active dual/clickhouse');

    expect(counters).toEqual({ created: 1, closed: 1 });
    expect(telemetry.queries).toEqual([]);
    expect(logs.queries).toEqual([]);
  });

  test('fails before opening sources when the configured login is not a project_migrator member', async () => {
    const control = fakeDatabase(
      [[activationRow()]],
      migratorSessionRow({ session_can_set_migrator: false }),
    );
    const telemetry = fakeDatabase([]);
    const logs = fakeDatabase([]);
    const output: string[] = [];
    const counters = { created: 0, closed: 0 };

    await expect(
      enforceLegacySignalWritePolicy(
        command(),
        environment(),
        dependencies(
          {
            control: control.database,
            telemetry: telemetry.database,
            logs: logs.database,
          },
          output,
          counters,
        ),
      ),
    ).rejects.toThrow('must be a member of project_migrator');

    expect(counters).toEqual({ created: 1, closed: 1 });
    expect(telemetry.queries).toEqual([]);
    expect(logs.queries).toEqual([]);
  });

  test('fails closed on unexpected telemetry ownership before any policy DDL', async () => {
    const control = fakeDatabase([[activationRow()]]);
    const telemetry = fakeDatabase([
      [roleRow()],
      telemetryRelations({ owner: 'project_telemetry_writer' }),
    ]);
    const logs = fakeDatabase([[roleRow()], logsRelations()]);
    const output: string[] = [];
    const counters = { created: 0, closed: 0 };

    await expect(
      enforceLegacySignalWritePolicy(
        command(),
        environment(),
        dependencies(
          {
            control: control.database,
            telemetry: telemetry.database,
            logs: logs.database,
          },
          output,
          counters,
        ),
      ),
    ).rejects.toThrow('must be owned by project_migrator');

    expect(
      [...telemetry.queries, ...logs.queries].some((query) =>
        query.sql.includes('legacy_signal_readonly'),
      ),
    ).toBe(false);
  });

  test('fails closed when project_migrator cannot own every logs Signal relation schema', async () => {
    const control = fakeDatabase([[activationRow()]]);
    const telemetry = fakeDatabase([[roleRow()], telemetryRelations()]);
    const logs = fakeDatabase([
      [roleRow()],
      logsRelations('project_logs_writer', {
        migrator_can_create_schema: false,
      }),
    ]);
    const output: string[] = [];
    const counters = { created: 0, closed: 0 };

    await expect(
      enforceLegacySignalWritePolicy(
        command(),
        environment(),
        dependencies(
          {
            control: control.database,
            telemetry: telemetry.database,
            logs: logs.database,
          },
          output,
          counters,
        ),
      ),
    ).rejects.toThrow('project_migrator needs CREATE on schema logs');

    expect(
      [...telemetry.queries, ...logs.queries].some((query) =>
        query.sql.includes('legacy_signal_readonly'),
      ),
    ).toBe(false);
    expect(output).toEqual([]);
  });

  test('restores only after an explicit writer rollback records the Blind Spot', async () => {
    const control = fakeDatabase([
      [
        activationRow({
          activation_kind: 'rollback',
          from_write_mode: 'clickhouse',
          from_read_mode: 'clickhouse',
          to_write_mode: 'dual',
          to_read_mode: 'postgres',
          blind_spot_since: ACTIVATED_AT,
        }),
      ],
    ]);
    const telemetry = fakeDatabase([[roleRow()], telemetryRelations(), []]);
    const logs = fakeDatabase([
      [roleRow()],
      logsRelations('project_migrator'),
      [],
      [],
    ]);
    const output: string[] = [];
    const counters = { created: 0, closed: 0 };

    await expect(
      enforceLegacySignalWritePolicy(
        command('unlock'),
        environment(),
        dependencies(
          {
            control: control.database,
            telemetry: telemetry.database,
            logs: logs.database,
          },
          output,
          counters,
        ),
      ),
    ).resolves.toMatchObject({
      action: 'unlock',
      readOnlyUntil: null,
      auditRecorded: true,
    });

    expect(
      telemetry.queries.some((query) =>
        query.sql.includes('GRANT SELECT, INSERT ON TABLE'),
      ),
    ).toBe(true);
    expect(
      logs.queries.some((query) =>
        query.sql.includes('OWNER TO project_logs_writer'),
      ),
    ).toBe(true);
    expect(logs.queries.at(-1)?.params[0]).toBe(
      'signal_postgres_writer_restored',
    );
  });

  test('supports a side effect free dry run after full Control and ownership preflight', async () => {
    const control = fakeDatabase([[activationRow()]]);
    const telemetry = fakeDatabase([[roleRow()], telemetryRelations()]);
    const logs = fakeDatabase([[roleRow()], logsRelations()]);
    const output: string[] = [];
    const counters = { created: 0, closed: 0 };

    await expect(
      enforceLegacySignalWritePolicy(
        command('lock', ['--dry-run']),
        environment(),
        dependencies(
          {
            control: control.database,
            telemetry: telemetry.database,
            logs: logs.database,
          },
          output,
          counters,
        ),
      ),
    ).resolves.toMatchObject({ auditRecorded: false });

    expect(
      [...telemetry.queries, ...logs.queries].some((query) =>
        query.sql.includes('legacy_signal_readonly'),
      ),
    ).toBe(false);
    expect(
      logs.queries.some((query) =>
        query.sql.includes('INSERT INTO logs.audit_trails'),
      ),
    ).toBe(false);
  });

  test('requires each source URL to authenticate as the configured migration login before policy DDL', async () => {
    const control = fakeDatabase([[activationRow()]]);
    const telemetry = fakeDatabase(
      [],
      migratorSessionRow({ session_role: 'project_telemetry_writer' }),
    );
    const logs = fakeDatabase([[roleRow()], logsRelations()]);
    const output: string[] = [];
    const counters = { created: 0, closed: 0 };

    await expect(
      enforceLegacySignalWritePolicy(
        command(),
        environment(),
        dependencies(
          {
            control: control.database,
            telemetry: telemetry.database,
            logs: logs.database,
          },
          output,
          counters,
        ),
      ),
    ).rejects.toThrow('must match OBSERVABILITY_MIGRATION_LOGIN');

    expect(
      [...telemetry.queries, ...logs.queries].some((query) =>
        query.sql.includes('legacy_signal_readonly'),
      ),
    ).toBe(false);
    expect(output).toEqual([]);
  });
});
