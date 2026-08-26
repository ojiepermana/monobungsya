import {
  closeDatabaseClient,
  createDatabaseClient,
  type DatabaseClient,
  withTransaction,
} from '#project/database';
import {
  observabilityControlDatabaseUrl,
  type PromotionControlEnvironment,
} from './record-observability-promotion';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const READ_ONLY_WINDOW_DAYS = 30;
const LEGACY_WRITE_PRIVILEGES =
  'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER';

const VALUE_ARGUMENT_NAMES = [
  'action',
  'activation-id',
  'actor-id',
  'reason',
  'confirm',
] as const;

type ValueArgumentName = (typeof VALUE_ARGUMENT_NAMES)[number];
export type LegacySignalWritePolicyAction = 'lock' | 'unlock';
type SignalSource = 'telemetry' | 'logs';

export interface LegacySignalWritePolicyCommand {
  readonly action: LegacySignalWritePolicyAction;
  readonly activationId: string;
  readonly actorId: string;
  readonly reason: string;
  readonly dryRun: boolean;
}

export interface LegacySignalWritePolicyEnvironment
  extends PromotionControlEnvironment {
  readonly OBSERVABILITY_MIGRATION_LOGIN?: string;
  readonly OBSERVABILITY_TELEMETRY_MIGRATION_URL?: string;
  readonly OBSERVABILITY_LOGS_MIGRATION_URL?: string;
}

export interface LegacySignalWritePolicyDependencies {
  readonly createDatabaseClient: (connectionString: string) => DatabaseClient;
  readonly closeDatabaseClient: (database: DatabaseClient) => Promise<void>;
  readonly write: (line: string) => void;
}

export interface LegacySignalWritePolicyResult {
  readonly action: LegacySignalWritePolicyAction;
  readonly activationId: string;
  readonly activationAt: string;
  readonly readOnlyUntil: string | null;
  readonly telemetryRelationCount: number;
  readonly logsRelationCount: number;
  readonly auditRecorded: boolean;
}

interface CurrentActivation {
  readonly activationId: string;
  readonly kind: 'initial' | 'forward' | 'rollback';
  readonly fromWriteMode: string;
  readonly fromReadMode: string;
  readonly toWriteMode: string;
  readonly toReadMode: string;
  readonly activatedAt: string;
  readonly blindSpotSince: string | null;
}

interface SourceRolePreflight {
  readonly sessionRole: string;
  readonly currentRole: string;
  readonly migratorExists: boolean;
  readonly logsWriterExists: boolean;
  readonly telemetryWriterExists: boolean;
  readonly migratorCanManageLogsWriter: boolean;
  readonly migratorCanWriteAudit: boolean;
}

interface SourceRelation {
  readonly schemaName: string;
  readonly relationName: string;
  readonly owner: string;
  readonly migratorCanCreateSchema: boolean;
  readonly logsWriterCanCreateSchema: boolean;
}

interface LockedSourcePostcondition {
  readonly relationCount: number;
  readonly ownerCount: number;
  readonly writableRelationCount: number;
  readonly migratorDelegateRelationCount: number;
}

interface MigratorSession {
  readonly sessionRole: string;
  readonly currentRole: string;
  readonly sessionCanSetMigrator: boolean;
}

const CONTROL_ACTIVATION_SQL = `
  SELECT
    id AS activation_id,
    activation_kind,
    from_write_mode,
    from_read_mode,
    to_write_mode,
    to_read_mode,
    activated_at,
    blind_spot_since
  FROM telemetry.signal_storage_activations
  ORDER BY activation_sequence DESC
  LIMIT 1
`;

const CONTROL_ACTIVATION_LOCK_SQL = `
  SELECT pg_advisory_xact_lock(
    hashtextextended('telemetry.signal_storage_activation', 0)
  )
`;

const MIGRATOR_SESSION_SQL = `
  SELECT
    session_user AS session_role,
    current_user AS current_role,
    COALESCE(
      pg_has_role(
        session_user,
        (SELECT oid FROM pg_roles WHERE rolname = 'project_migrator'),
        'MEMBER'
      ),
      false
    ) AS session_can_set_migrator
`;

const ROLE_PREFLIGHT_SQL = `
  SELECT
    session_user AS session_role,
    current_user AS current_role,
    EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname = 'project_migrator'
    ) AS migrator_exists,
    EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname = 'project_logs_writer'
    ) AS logs_writer_exists,
    EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname = 'project_telemetry_writer'
    ) AS telemetry_writer_exists,
    COALESCE(
      pg_has_role(
        current_user,
        (
          SELECT oid FROM pg_roles WHERE rolname = 'project_logs_writer'
        ),
        'MEMBER'
      ),
      false
    ) AS migrator_can_manage_logs_writer,
    COALESCE(
      has_table_privilege(
        (SELECT oid FROM pg_roles WHERE rolname = 'project_migrator'),
        to_regclass('logs.audit_trails'),
        'INSERT'
      ),
      false
    ) AS migrator_can_write_audit
`;

function relationTree(source: SignalSource): string {
  const roots =
    source === 'telemetry'
      ? "(namespace.nspname = 'telemetry' AND class.relname IN ('spans', 'metric_buckets'))"
      : "(namespace.nspname = 'logs' AND class.relname IN ('logging', 'access_logs'))";
  return `
    WITH RECURSIVE signal_relations AS (
      SELECT
        class.oid AS relation_oid,
        namespace.nspname AS schema_name,
        class.relname AS relation_name
      FROM pg_class AS class
      JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
      WHERE ${roots}
      UNION
      SELECT
        child.oid AS relation_oid,
        child_namespace.nspname AS schema_name,
        child.relname AS relation_name
      FROM pg_inherits AS inheritance
      JOIN signal_relations AS parent ON parent.relation_oid = inheritance.inhparent
      JOIN pg_class AS child ON child.oid = inheritance.inhrelid
      JOIN pg_namespace AS child_namespace ON child_namespace.oid = child.relnamespace
    )
  `;
}

const SOURCE_RELATION_SQL: Record<SignalSource, string> = {
  telemetry: `
    ${relationTree('telemetry')}
    SELECT
      signal_relations.schema_name,
      signal_relations.relation_name,
      pg_get_userbyid(class.relowner) AS owner,
      COALESCE(
        has_schema_privilege(
          (SELECT oid FROM pg_roles WHERE rolname = 'project_migrator'),
          class.relnamespace,
          'CREATE'
        ),
        false
      ) AS migrator_can_create_schema,
      COALESCE(
        has_schema_privilege(
          (SELECT oid FROM pg_roles WHERE rolname = 'project_logs_writer'),
          class.relnamespace,
          'CREATE'
        ),
        false
      ) AS logs_writer_can_create_schema
    FROM signal_relations
    JOIN pg_class AS class ON class.oid = signal_relations.relation_oid
    ORDER BY signal_relations.schema_name, signal_relations.relation_name
  `,
  logs: `
    ${relationTree('logs')}
    SELECT
      signal_relations.schema_name,
      signal_relations.relation_name,
      pg_get_userbyid(class.relowner) AS owner,
      COALESCE(
        has_schema_privilege(
          (SELECT oid FROM pg_roles WHERE rolname = 'project_migrator'),
          class.relnamespace,
          'CREATE'
        ),
        false
      ) AS migrator_can_create_schema,
      COALESCE(
        has_schema_privilege(
          (SELECT oid FROM pg_roles WHERE rolname = 'project_logs_writer'),
          class.relnamespace,
          'CREATE'
        ),
        false
      ) AS logs_writer_can_create_schema
    FROM signal_relations
    JOIN pg_class AS class ON class.oid = signal_relations.relation_oid
    ORDER BY signal_relations.schema_name, signal_relations.relation_name
  `,
};

function lockSql(source: SignalSource): string {
  const transferOwnership =
    source === 'logs'
      ? `
        EXECUTE format(
          'ALTER TABLE %I.%I OWNER TO project_migrator',
          relation_record.schema_name,
          relation_record.relation_name
        );
      `
      : '';
  const lockName = `observability.${source}.legacy_signal_readonly`;

  return `
    DO $$
    DECLARE
      relation_record record;
      role_record record;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('${lockName}', 0));
      FOR relation_record IN
        ${relationTree(source)}
        SELECT schema_name, relation_name
        FROM signal_relations
      LOOP
        EXECUTE format(
          'LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE',
          relation_record.schema_name,
          relation_record.relation_name
        );
        ${transferOwnership}
        EXECUTE format(
          'REVOKE ${LEGACY_WRITE_PRIVILEGES} ON TABLE %I.%I FROM PUBLIC',
          relation_record.schema_name,
          relation_record.relation_name
        );
        FOR role_record IN
          SELECT rolname
          FROM pg_roles
          WHERE rolname !~ '^pg_'
            AND rolname <> 'project_migrator'
        LOOP
          EXECUTE format(
            'REVOKE ${LEGACY_WRITE_PRIVILEGES} ON TABLE %I.%I FROM %I',
            relation_record.schema_name,
            relation_record.relation_name,
            role_record.rolname
          );
        END LOOP;
      END LOOP;
    END;
    $$;
  `;
}

const UNLOCK_TELEMETRY_SQL = `
  GRANT SELECT, INSERT ON TABLE
    telemetry.spans,
    telemetry.metric_buckets
  TO project_telemetry_writer;
  GRANT UPDATE ON TABLE telemetry.metric_buckets TO project_telemetry_writer;
`;

const UNLOCK_LOGS_SQL = `
  DO $$
  DECLARE
    relation_record record;
  BEGIN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('observability.logs.legacy_signal_readonly', 0)
    );
    FOR relation_record IN
      ${relationTree('logs')}
      SELECT schema_name, relation_name
      FROM signal_relations
    LOOP
      EXECUTE format(
        'LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE',
        relation_record.schema_name,
        relation_record.relation_name
      );
      EXECUTE format(
        'ALTER TABLE %I.%I OWNER TO project_logs_writer',
        relation_record.schema_name,
        relation_record.relation_name
      );
    END LOOP;
  END;
  $$;
`;

function lockedSourcePostconditionSql(source: SignalSource): string {
  return `
    ${relationTree(source)}
    SELECT
      count(*) AS relation_count,
      count(*) FILTER (
        WHERE pg_get_userbyid(class.relowner) = 'project_migrator'
      ) AS owner_count,
      count(*) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM pg_roles AS role
          WHERE role.rolname !~ '^pg_'
            AND role.rolname <> 'project_migrator'
            AND role.rolsuper IS DISTINCT FROM true
            AND (
              has_table_privilege(role.oid, class.oid, 'INSERT')
              OR has_table_privilege(role.oid, class.oid, 'UPDATE')
              OR has_table_privilege(role.oid, class.oid, 'DELETE')
              OR has_table_privilege(role.oid, class.oid, 'TRUNCATE')
              OR has_table_privilege(role.oid, class.oid, 'REFERENCES')
              OR has_table_privilege(role.oid, class.oid, 'TRIGGER')
            )
        )
      ) AS writable_relation_count,
      count(*) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM pg_roles AS role
          WHERE role.rolname !~ '^pg_'
            AND role.rolname NOT IN ('project_migrator', $1)
            AND role.rolsuper IS DISTINCT FROM true
            AND COALESCE(
              pg_has_role(
                role.oid,
                (
                  SELECT oid
                  FROM pg_roles
                  WHERE rolname = 'project_migrator'
                ),
                'SET'
              ),
              false
            )
        )
      ) AS migrator_delegate_relation_count
    FROM signal_relations
    JOIN pg_class AS class ON class.oid = signal_relations.relation_oid
  `;
}

const WRITE_AUDIT_SQL = `
  INSERT INTO logs.audit_trails (
    id,
    action,
    module,
    entity_type,
    entity_id,
    actor_name,
    reason,
    change_summary,
    metadata,
    audited_at,
    created_at
  ) VALUES (
    uuidv7(),
    $1,
    'observability',
    'signal_postgres_write_policy',
    $2,
    $3,
    $4,
    $5,
    $6::jsonb,
    CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
    CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
  )
`;

const defaultDependencies: LegacySignalWritePolicyDependencies = {
  createDatabaseClient,
  closeDatabaseClient,
  write: (line) => console.log(line),
};

function usage(): string {
  return [
    'Usage: bun run observability:postgres:legacy-write-policy --',
    '  --action <lock|unlock>',
    '  --activation-id <storage-activation-uuid>',
    '  --actor-id <operator-id>',
    '  --reason <change-reason>',
    '  --confirm <lock|unlock>:<storage-activation-uuid>',
    '  [--dry-run]',
    '',
    'Required environment:',
    '  OBSERVABILITY_DATABASE_URL',
    '  OBSERVABILITY_MIGRATION_LOGIN',
    '  OBSERVABILITY_TELEMETRY_MIGRATION_URL',
    '  OBSERVABILITY_LOGS_MIGRATION_URL',
  ].join('\n');
}

function isValueArgumentName(value: string): value is ValueArgumentName {
  return VALUE_ARGUMENT_NAMES.some((name) => name === value);
}

function parseArgumentValues(argv: readonly string[]): {
  readonly values: Map<ValueArgumentName, string>;
  readonly dryRun: boolean;
} {
  const values = new Map<ValueArgumentName, string>();
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument ?? ''}\n${usage()}`);
    }
    if (argument === '--dry-run') {
      if (dryRun)
        throw new Error('Argument may only be specified once: --dry-run');
      dryRun = true;
      continue;
    }

    const name = argument.slice(2);
    if (!isValueArgumentName(name)) {
      throw new Error(`Unknown argument: ${argument}\n${usage()}`);
    }
    if (values.has(name)) {
      throw new Error(`Argument may only be specified once: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}\n${usage()}`);
    }
    values.set(name, value);
    index += 1;
  }

  for (const name of VALUE_ARGUMENT_NAMES) {
    if (!values.has(name)) {
      throw new Error(`Missing required argument: --${name}\n${usage()}`);
    }
  }
  return { values, dryRun };
}

function requiredValue(
  values: ReadonlyMap<ValueArgumentName, string>,
  name: ValueArgumentName,
): string {
  const value = values.get(name)?.trim();
  if (!value) throw new Error(`Argument --${name} must not be empty`);
  return value;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function parseAction(value: string): LegacySignalWritePolicyAction {
  if (value === 'lock' || value === 'unlock') return value;
  throw new Error('--action must be one of: lock, unlock');
}

function parseUuid(value: string, argument: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error(`${argument} must be a UUID`);
  return value;
}

function parseOperatorText(
  value: string,
  argument: string,
  maximumLength: number,
): string {
  if (value.length > maximumLength) {
    throw new Error(`${argument} must be at most ${maximumLength} characters`);
  }
  if (hasControlCharacter(value)) {
    throw new Error(`${argument} must not contain control characters`);
  }
  return value;
}

export function parseLegacySignalWritePolicyCommand(
  argv: readonly string[],
): LegacySignalWritePolicyCommand {
  const { values, dryRun } = parseArgumentValues(argv);
  const action = parseAction(requiredValue(values, 'action'));
  const activationId = parseUuid(
    requiredValue(values, 'activation-id'),
    '--activation-id',
  );
  const confirmation = requiredValue(values, 'confirm');
  if (confirmation !== `${action}:${activationId}`) {
    throw new Error('--confirm must exactly match <action>:<activation-id>');
  }

  return {
    action,
    activationId,
    actorId: parseOperatorText(
      requiredValue(values, 'actor-id'),
      '--actor-id',
      150,
    ),
    reason: parseOperatorText(
      requiredValue(values, 'reason'),
      '--reason',
      4_000,
    ),
    dryRun,
  };
}

function postgresUrl(
  environment: LegacySignalWritePolicyEnvironment,
  name:
    | 'OBSERVABILITY_TELEMETRY_MIGRATION_URL'
    | 'OBSERVABILITY_LOGS_MIGRATION_URL',
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for legacy Signal policy`);
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      throw new Error('invalid protocol');
    }
  } catch {
    throw new Error(`${name} must be a PostgreSQL URL`);
  }
  return value;
}

function migrationLogin(
  environment: LegacySignalWritePolicyEnvironment,
): string {
  const value = environment.OBSERVABILITY_MIGRATION_LOGIN?.trim();
  if (!value) {
    throw new Error(
      'OBSERVABILITY_MIGRATION_LOGIN is required for legacy Signal policy',
    );
  }
  if (!/^[a-z_][a-z0-9_$]{0,62}$/.test(value)) {
    throw new Error(
      'OBSERVABILITY_MIGRATION_LOGIN must be an unquoted PostgreSQL role name',
    );
  }
  return value;
}

function asRow(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function textValue(row: Record<string, unknown>, name: string): string {
  const value = row[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function booleanValue(row: Record<string, unknown>, name: string): boolean {
  if (typeof row[name] !== 'boolean') throw new Error(`Invalid ${name}`);
  return row[name] as boolean;
}

function timestampValue(row: Record<string, unknown>, name: string): string {
  const value = row[name];
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${name}`);
  return parsed.toISOString();
}

function nullableTimestampValue(
  row: Record<string, unknown>,
  name: string,
): string | null {
  const value = row[name];
  if (value === null || value === undefined) return null;
  return timestampValue(row, name);
}

function countValue(row: Record<string, unknown>, name: string): number {
  const value = row[name];
  const numeric =
    typeof value === 'bigint'
      ? Number(value)
      : typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error(`Invalid ${name}`);
  }
  return numeric;
}

function activationFromRow(value: unknown): CurrentActivation {
  const row = asRow(value, 'Signal storage activation');
  const kind = textValue(row, 'activation_kind');
  if (kind !== 'initial' && kind !== 'forward' && kind !== 'rollback') {
    throw new Error('Invalid activation_kind');
  }
  return {
    activationId: parseUuid(textValue(row, 'activation_id'), 'activation_id'),
    kind,
    fromWriteMode: textValue(row, 'from_write_mode'),
    fromReadMode: textValue(row, 'from_read_mode'),
    toWriteMode: textValue(row, 'to_write_mode'),
    toReadMode: textValue(row, 'to_read_mode'),
    activatedAt: timestampValue(row, 'activated_at'),
    blindSpotSince: nullableTimestampValue(row, 'blind_spot_since'),
  };
}

function rolePreflightFromRow(value: unknown): SourceRolePreflight {
  const row = asRow(value, 'legacy Signal role preflight');
  return {
    sessionRole: textValue(row, 'session_role'),
    currentRole: textValue(row, 'current_role'),
    migratorExists: booleanValue(row, 'migrator_exists'),
    logsWriterExists: booleanValue(row, 'logs_writer_exists'),
    telemetryWriterExists: booleanValue(row, 'telemetry_writer_exists'),
    migratorCanManageLogsWriter: booleanValue(
      row,
      'migrator_can_manage_logs_writer',
    ),
    migratorCanWriteAudit: booleanValue(row, 'migrator_can_write_audit'),
  };
}

function relationFromRow(value: unknown): SourceRelation {
  const row = asRow(value, 'legacy Signal relation');
  return {
    schemaName: textValue(row, 'schema_name'),
    relationName: textValue(row, 'relation_name'),
    owner: textValue(row, 'owner'),
    migratorCanCreateSchema: booleanValue(row, 'migrator_can_create_schema'),
    logsWriterCanCreateSchema: booleanValue(
      row,
      'logs_writer_can_create_schema',
    ),
  };
}

function lockedSourcePostconditionFromRow(
  value: unknown,
): LockedSourcePostcondition {
  const row = asRow(value, 'locked legacy Signal source postcondition');
  return {
    relationCount: countValue(row, 'relation_count'),
    ownerCount: countValue(row, 'owner_count'),
    writableRelationCount: countValue(row, 'writable_relation_count'),
    migratorDelegateRelationCount: countValue(
      row,
      'migrator_delegate_relation_count',
    ),
  };
}

function migratorSessionFromRow(value: unknown): MigratorSession {
  const row = asRow(value, 'legacy Signal migrator session');
  return {
    sessionRole: textValue(row, 'session_role'),
    currentRole: textValue(row, 'current_role'),
    sessionCanSetMigrator: booleanValue(row, 'session_can_set_migrator'),
  };
}

function expectedRoots(source: SignalSource): readonly string[] {
  return source === 'telemetry'
    ? ['telemetry.spans', 'telemetry.metric_buckets']
    : ['logs.logging', 'logs.access_logs'];
}

function validateMigratorSession(
  scope: string,
  expectedSessionRole: string,
  session: MigratorSession,
): void {
  if (session.sessionRole !== expectedSessionRole) {
    throw new Error(
      `${scope} source session user must match OBSERVABILITY_MIGRATION_LOGIN`,
    );
  }
  if (!session.sessionCanSetMigrator) {
    throw new Error(
      `${scope} source session must be a member of project_migrator`,
    );
  }
  if (session.currentRole !== 'project_migrator') {
    throw new Error(
      `${scope} source must be able to SET LOCAL ROLE project_migrator`,
    );
  }
}

async function withMigratorRole<T>(
  database: DatabaseClient,
  scope: string,
  expectedSessionRole: string,
  operation: (transaction: DatabaseClient) => Promise<T>,
): Promise<T> {
  return withTransaction(database, async (transaction) => {
    try {
      await transaction.unsafe('SET LOCAL ROLE project_migrator');
    } catch {
      throw new Error(
        `${scope} source session must be able to SET LOCAL ROLE project_migrator`,
      );
    }
    const sessionRows = (await transaction.unsafe(
      MIGRATOR_SESSION_SQL,
    )) as unknown[];
    if (sessionRows.length !== 1) {
      throw new Error(`${scope} source role session is unavailable`);
    }
    validateMigratorSession(
      scope,
      expectedSessionRole,
      migratorSessionFromRow(sessionRows[0]),
    );
    return operation(transaction);
  });
}

function validateActivation(
  activation: CurrentActivation,
  command: LegacySignalWritePolicyCommand,
): void {
  if (activation.activationId !== command.activationId) {
    throw new Error(
      'Control activation ID is not the active Signal storage state',
    );
  }
  if (command.action === 'lock') {
    if (
      activation.kind !== 'forward' ||
      activation.fromWriteMode !== 'dual' ||
      activation.fromReadMode !== 'clickhouse' ||
      activation.toWriteMode !== 'clickhouse' ||
      activation.toReadMode !== 'clickhouse'
    ) {
      throw new Error(
        'lock requires the active dual/clickhouse to clickhouse/clickhouse writer cutover',
      );
    }
    return;
  }
  if (
    activation.kind !== 'rollback' ||
    activation.fromWriteMode !== 'clickhouse' ||
    activation.fromReadMode !== 'clickhouse' ||
    activation.toWriteMode !== 'dual' ||
    activation.toReadMode !== 'postgres' ||
    activation.blindSpotSince === null
  ) {
    throw new Error(
      'unlock requires the active writer rollback with a recorded Blind Spot',
    );
  }
}

function validateSourcePreflight(
  source: SignalSource,
  action: LegacySignalWritePolicyAction,
  expectedSessionRole: string,
  rolePreflight: SourceRolePreflight,
  relations: readonly SourceRelation[],
): void {
  if (rolePreflight.sessionRole !== expectedSessionRole) {
    throw new Error(
      `${source} source session user must match OBSERVABILITY_MIGRATION_LOGIN`,
    );
  }
  if (rolePreflight.currentRole !== 'project_migrator') {
    throw new Error(
      `${source} source must use the project_migrator credential`,
    );
  }
  if (!rolePreflight.migratorExists) {
    throw new Error(`${source} source is missing project_migrator`);
  }
  if (source === 'telemetry' && !rolePreflight.telemetryWriterExists) {
    throw new Error('telemetry source is missing project_telemetry_writer');
  }
  if (source === 'logs' && !rolePreflight.logsWriterExists) {
    throw new Error('logs source is missing project_logs_writer');
  }
  if (source === 'logs' && !rolePreflight.migratorCanManageLogsWriter) {
    throw new Error(
      `${source} source requires project_migrator membership in project_logs_writer`,
    );
  }
  if (source === 'logs' && !rolePreflight.migratorCanWriteAudit) {
    throw new Error(
      'logs source requires project_migrator INSERT privilege on logs.audit_trails',
    );
  }

  const roots = new Set(
    relations.map(
      (relation) => `${relation.schemaName}.${relation.relationName}`,
    ),
  );
  for (const root of expectedRoots(source)) {
    if (!roots.has(root)) {
      throw new Error(
        `${source} source is missing legacy Signal table ${root}`,
      );
    }
  }
  if (relations.length === 0) {
    throw new Error(`${source} source has no legacy Signal relations`);
  }

  for (const relation of relations) {
    if (source === 'telemetry' && relation.owner !== 'project_migrator') {
      throw new Error(
        `telemetry relation ${relation.schemaName}.${relation.relationName} must be owned by project_migrator`,
      );
    }
    if (
      source === 'logs' &&
      action === 'lock' &&
      relation.owner !== 'project_migrator' &&
      relation.owner !== 'project_logs_writer'
    ) {
      throw new Error(
        `logs relation ${relation.schemaName}.${relation.relationName} has an unsupported owner`,
      );
    }
    if (
      source === 'logs' &&
      action === 'lock' &&
      !relation.migratorCanCreateSchema
    ) {
      throw new Error(
        `project_migrator needs CREATE on schema ${relation.schemaName} to lock logs Signal relations`,
      );
    }
    if (
      source === 'logs' &&
      action === 'unlock' &&
      relation.owner !== 'project_migrator'
    ) {
      throw new Error(
        `logs relation ${relation.schemaName}.${relation.relationName} is not locked by project_migrator`,
      );
    }
    if (
      source === 'logs' &&
      action === 'unlock' &&
      !relation.logsWriterCanCreateSchema
    ) {
      throw new Error(
        `project_logs_writer needs CREATE on schema ${relation.schemaName} to unlock logs Signal relations`,
      );
    }
  }
}

async function currentActivation(
  database: DatabaseClient,
): Promise<CurrentActivation> {
  const rows = (await database.unsafe(CONTROL_ACTIVATION_SQL)) as unknown[];
  if (rows.length !== 1)
    throw new Error('Signal storage activation state is missing');
  return activationFromRow(rows[0]);
}

async function sourcePreflight(
  database: DatabaseClient,
  source: SignalSource,
  action: LegacySignalWritePolicyAction,
  expectedSessionRole: string,
): Promise<readonly SourceRelation[]> {
  return withMigratorRole(
    database,
    source,
    expectedSessionRole,
    async (transaction) => {
      const roleRows = (await transaction.unsafe(
        ROLE_PREFLIGHT_SQL,
      )) as unknown[];
      if (roleRows.length !== 1) {
        throw new Error(`${source} source role preflight is unavailable`);
      }
      const relationRows = (await transaction.unsafe(
        SOURCE_RELATION_SQL[source],
      )) as unknown[];
      const relations = relationRows.map(relationFromRow);
      validateSourcePreflight(
        source,
        action,
        expectedSessionRole,
        rolePreflightFromRow(roleRows[0]),
        relations,
      );
      return relations;
    },
  );
}

function readOnlyUntil(activationAt: string): string {
  const until = new Date(activationAt);
  until.setUTCDate(until.getUTCDate() + READ_ONLY_WINDOW_DAYS);
  return until.toISOString();
}

async function applySourcePolicy(
  database: DatabaseClient,
  source: SignalSource,
  command: LegacySignalWritePolicyCommand,
  auditMetadata: string | null,
  expectedRelationCount: number,
  expectedSessionRole: string,
): Promise<void> {
  if (command.dryRun) return;
  await withMigratorRole(
    database,
    source,
    expectedSessionRole,
    async (transaction) => {
      await transaction.unsafe("SET LOCAL lock_timeout = '5s'");
      await transaction.unsafe("SET LOCAL statement_timeout = '30s'");
      if (command.action === 'lock') {
        await transaction.unsafe(lockSql(source));
        const postconditionRows = (await transaction.unsafe(
          lockedSourcePostconditionSql(source),
          [expectedSessionRole] as never[],
        )) as unknown[];
        if (postconditionRows.length !== 1) {
          throw new Error(
            `${source} legacy Signal policy postcondition is unavailable`,
          );
        }
        const postcondition = lockedSourcePostconditionFromRow(
          postconditionRows[0],
        );
        if (
          postcondition.relationCount !== expectedRelationCount ||
          postcondition.ownerCount !== expectedRelationCount ||
          postcondition.writableRelationCount !== 0 ||
          postcondition.migratorDelegateRelationCount !== 0
        ) {
          throw new Error(
            `${source} legacy Signal policy did not make every relation read only`,
          );
        }
      } else if (source === 'telemetry') {
        await transaction.unsafe(UNLOCK_TELEMETRY_SQL);
      } else {
        await transaction.unsafe(UNLOCK_LOGS_SQL);
      }

      if (source === 'logs' && auditMetadata !== null) {
        const auditAction =
          command.action === 'lock'
            ? 'signal_postgres_readonly_locked'
            : 'signal_postgres_writer_restored';
        const summary =
          command.action === 'lock'
            ? 'Legacy PostgreSQL Signal tables were made read only after ClickHouse writer cutover.'
            : 'Legacy PostgreSQL Signal writers were restored for an explicit writer rollback.';
        await transaction.unsafe(WRITE_AUDIT_SQL, [
          auditAction,
          command.activationId,
          command.actorId,
          command.reason,
          summary,
          auditMetadata,
        ] as never[]);
      }
    },
  );
}

/**
 * Applies the explicit old PostgreSQL Signal writer policy only after Control
 * has recorded the matching writer cutover or rollback. It never assumes that
 * Control, telemetry, and logs use the same PostgreSQL database.
 */
export async function enforceLegacySignalWritePolicy(
  argv: readonly string[],
  environment: LegacySignalWritePolicyEnvironment = Bun.env,
  dependencies: LegacySignalWritePolicyDependencies = defaultDependencies,
): Promise<LegacySignalWritePolicyResult> {
  const command = parseLegacySignalWritePolicyCommand(argv);
  const expectedSessionRole = migrationLogin(environment);
  const controlDatabaseUrl = observabilityControlDatabaseUrl(environment);
  const telemetryDatabaseUrl = postgresUrl(
    environment,
    'OBSERVABILITY_TELEMETRY_MIGRATION_URL',
  );
  const logsDatabaseUrl = postgresUrl(
    environment,
    'OBSERVABILITY_LOGS_MIGRATION_URL',
  );
  const controlDatabase = dependencies.createDatabaseClient(controlDatabaseUrl);
  try {
    const result = await withMigratorRole(
      controlDatabase,
      'Control',
      expectedSessionRole,
      async (controlTransaction) => {
        await controlTransaction.unsafe("SET LOCAL lock_timeout = '5s'");
        await controlTransaction.unsafe(CONTROL_ACTIVATION_LOCK_SQL);
        const activation = await currentActivation(controlTransaction);
        validateActivation(activation, command);

        const telemetryDatabase =
          dependencies.createDatabaseClient(telemetryDatabaseUrl);
        let logsDatabase: DatabaseClient | null = null;
        try {
          logsDatabase = dependencies.createDatabaseClient(logsDatabaseUrl);
          const [telemetryRelations, logsRelations] = await Promise.all([
            sourcePreflight(
              telemetryDatabase,
              'telemetry',
              command.action,
              expectedSessionRole,
            ),
            sourcePreflight(
              logsDatabase,
              'logs',
              command.action,
              expectedSessionRole,
            ),
          ]);
          const expiry =
            command.action === 'lock'
              ? readOnlyUntil(activation.activatedAt)
              : null;
          const auditMetadata = JSON.stringify({
            action: command.action,
            activationId: command.activationId,
            activationAt: activation.activatedAt,
            readOnlyUntil: expiry,
            telemetryRelationCount: telemetryRelations.length,
            logsRelationCount: logsRelations.length,
            result: 'succeeded',
          });

          await applySourcePolicy(
            telemetryDatabase,
            'telemetry',
            command,
            null,
            telemetryRelations.length,
            expectedSessionRole,
          );
          await applySourcePolicy(
            logsDatabase,
            'logs',
            command,
            auditMetadata,
            logsRelations.length,
            expectedSessionRole,
          );

          return {
            action: command.action,
            activationId: activation.activationId,
            activationAt: activation.activatedAt,
            readOnlyUntil: expiry,
            telemetryRelationCount: telemetryRelations.length,
            logsRelationCount: logsRelations.length,
            auditRecorded: !command.dryRun,
          };
        } finally {
          if (logsDatabase !== null) {
            await dependencies.closeDatabaseClient(logsDatabase);
          }
          await dependencies.closeDatabaseClient(telemetryDatabase);
        }
      },
    );
    dependencies.write(JSON.stringify(result));
    return result;
  } finally {
    await dependencies.closeDatabaseClient(controlDatabase);
  }
}

export async function main(): Promise<void> {
  await enforceLegacySignalWritePolicy(Bun.argv.slice(2));
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
