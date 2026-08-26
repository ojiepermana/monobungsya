import {
  closeDatabaseClient,
  createDatabaseClient,
  type DatabaseClient,
} from '#project/database';
import {
  ClickHouseClient,
  ClickHouseSignalBackfillGuard,
  ClickHouseSignalBackfillTarget,
  PostgresSignalBackfillControl,
  PostgresSignalBackfillSource,
  SignalBackfillOrchestrator,
  type SignalBackfillResult,
  type SignalKind,
} from '#project/observability';

const VALUE_ARGUMENTS = [
  'kind',
  'source-day',
  'page-size',
  'max-threads',
  'host-cpu-threads',
  'max-memory-bytes',
  'host-memory-bytes',
  'max-write-bytes-per-second',
  'measured-disk-write-bytes-per-second',
  'guard-evidence',
] as const;
const REQUIRED_VALUE_ARGUMENTS = [
  'kind',
  'source-day',
  'max-threads',
  'host-cpu-threads',
  'max-memory-bytes',
  'host-memory-bytes',
  'max-write-bytes-per-second',
  'measured-disk-write-bytes-per-second',
  'guard-evidence',
] as const;
const EXECUTION_FLAGS = new Set(['execute', 'confirm-retained-postgres']);
const SIGNAL_KINDS = new Set<SignalKind>([
  'span',
  'metric_bucket',
  'application_log',
  'access_log',
]);
const UTC_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type ValueArgument = (typeof VALUE_ARGUMENTS)[number];

export type SignalBackfillEnvironment = Readonly<
  Record<string, string | undefined>
>;

export interface SignalBackfillCommand {
  readonly kind: SignalKind;
  readonly sourceDay: string;
  readonly pageSize: number | undefined;
  readonly maxThreads: number;
  readonly hostCpuThreads: number;
  readonly maxMemoryBytes: number;
  readonly hostMemoryBytes: number;
  readonly maxWriteBytesPerSecond: number;
  readonly measuredDiskWriteBytesPerSecond: number;
  readonly guardEvidencePath: string;
}

export interface SignalBackfillCommandDependencies {
  readonly createDatabaseClient: (connectionString: string) => DatabaseClient;
  readonly closeDatabaseClient: (database: DatabaseClient) => Promise<void>;
  readonly readGuardEvidence: (path: string) => Promise<unknown>;
  readonly write: (line: string) => void;
}

function usage(): string {
  return [
    'Usage: bun run observability:backfill --',
    '  --execute --confirm-retained-postgres',
    '  --kind <span|metric_bucket|application_log|access_log>',
    '  --source-day <YYYY-MM-DD>',
    '  --max-threads <positive-integer>',
    '  --host-cpu-threads <positive-integer>',
    '  --max-memory-bytes <positive-integer>',
    '  --host-memory-bytes <positive-integer>',
    '  --max-write-bytes-per-second <positive-integer>',
    '  --measured-disk-write-bytes-per-second <positive-integer>',
    '  --guard-evidence <path-to-current-json>',
    '  [--page-size <1..5000>]',
    '',
    'Guard evidence must contain observedAt, freshnessP95Ms, querySloGreen, and queueDropCount.',
  ].join('\n');
}

function isValueArgument(value: string): value is ValueArgument {
  return VALUE_ARGUMENTS.some((name) => name === value);
}

function parsePositiveInteger(
  value: string,
  name: string,
  max?: number,
): number {
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    (max !== undefined && parsed > max)
  ) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function requiredValue(
  values: ReadonlyMap<ValueArgument, string>,
  name: ValueArgument,
): string {
  const value = values.get(name)?.trim();
  if (!value)
    throw new Error(`Missing required argument --${name}\n${usage()}`);
  return value;
}

function parseUtcDay(value: string): string {
  if (!UTC_DAY_PATTERN.test(value)) {
    throw new Error('--source-day must use YYYY-MM-DD UTC format');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error('--source-day must be a real UTC calendar day');
  }
  return value;
}

function requireThirtyPercentBudget(
  requested: number,
  available: number,
  requestedName: string,
  availableName: string,
): void {
  const maximum = Math.floor(available * 0.3);
  if (maximum < 1 || requested > maximum) {
    throw new Error(
      `${requestedName} must not exceed 30 percent of ${availableName}`,
    );
  }
}

export function parseSignalBackfillCommand(
  argv: readonly string[],
): SignalBackfillCommand {
  const values = new Map<ValueArgument, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument ?? ''}\n${usage()}`);
    }
    const name = argument.slice(2);
    if (EXECUTION_FLAGS.has(name)) {
      if (flags.has(name))
        throw new Error(`Argument may only appear once: ${argument}`);
      flags.add(name);
      continue;
    }
    if (!isValueArgument(name)) {
      throw new Error(`Unknown argument: ${argument}\n${usage()}`);
    }
    if (values.has(name))
      throw new Error(`Argument may only appear once: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}\n${usage()}`);
    }
    values.set(name, value);
    index += 1;
  }

  for (const flag of EXECUTION_FLAGS) {
    if (!flags.has(flag)) {
      throw new Error(
        `--${flag} is required before a Signal backfill can write`,
      );
    }
  }
  for (const name of REQUIRED_VALUE_ARGUMENTS) requiredValue(values, name);

  const kindValue = requiredValue(values, 'kind');
  if (!SIGNAL_KINDS.has(kindValue as SignalKind)) {
    throw new Error('--kind must name one supported Signal kind');
  }
  const hostCpuThreads = parsePositiveInteger(
    requiredValue(values, 'host-cpu-threads'),
    '--host-cpu-threads',
  );
  const maxThreads = parsePositiveInteger(
    requiredValue(values, 'max-threads'),
    '--max-threads',
  );
  requireThirtyPercentBudget(
    maxThreads,
    hostCpuThreads,
    '--max-threads',
    'host CPU threads',
  );
  const hostMemoryBytes = parsePositiveInteger(
    requiredValue(values, 'host-memory-bytes'),
    '--host-memory-bytes',
  );
  const maxMemoryBytes = parsePositiveInteger(
    requiredValue(values, 'max-memory-bytes'),
    '--max-memory-bytes',
  );
  requireThirtyPercentBudget(
    maxMemoryBytes,
    hostMemoryBytes,
    '--max-memory-bytes',
    'host memory bytes',
  );
  const measuredDiskWriteBytesPerSecond = parsePositiveInteger(
    requiredValue(values, 'measured-disk-write-bytes-per-second'),
    '--measured-disk-write-bytes-per-second',
  );
  const maxWriteBytesPerSecond = parsePositiveInteger(
    requiredValue(values, 'max-write-bytes-per-second'),
    '--max-write-bytes-per-second',
  );
  requireThirtyPercentBudget(
    maxWriteBytesPerSecond,
    measuredDiskWriteBytesPerSecond,
    '--max-write-bytes-per-second',
    'measured disk write bytes per second',
  );

  return {
    kind: kindValue as SignalKind,
    sourceDay: parseUtcDay(requiredValue(values, 'source-day')),
    pageSize: values.has('page-size')
      ? parsePositiveInteger(
          requiredValue(values, 'page-size'),
          '--page-size',
          5_000,
        )
      : undefined,
    maxThreads,
    hostCpuThreads,
    maxMemoryBytes,
    hostMemoryBytes,
    maxWriteBytesPerSecond,
    measuredDiskWriteBytesPerSecond,
    guardEvidencePath: requiredValue(values, 'guard-evidence'),
  };
}

function requiredEnvironmentValue(
  environment: SignalBackfillEnvironment,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value)
    throw new Error(`${name} is required for an explicit Signal backfill`);
  return value;
}

function postgresUrl(
  environment: SignalBackfillEnvironment,
  name: string,
): string {
  const value = requiredEnvironmentValue(environment, name);
  try {
    const url = new URL(value);
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
      throw new Error('invalid protocol');
    }
  } catch {
    throw new Error(`${name} must be a PostgreSQL URL`);
  }
  return value;
}

function clickHouseOptions(
  environment: SignalBackfillEnvironment,
  role: 'WRITER' | 'READER',
): ConstructorParameters<typeof ClickHouseClient>[0] {
  const url = requiredEnvironmentValue(environment, 'CLICKHOUSE_URL');
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new Error('invalid endpoint');
    }
  } catch {
    throw new Error('CLICKHOUSE_URL must be a credential free HTTPS URL');
  }
  return {
    url,
    username: requiredEnvironmentValue(
      environment,
      `CLICKHOUSE_${role}_USERNAME`,
    ),
    password: requiredEnvironmentValue(
      environment,
      `CLICKHOUSE_${role}_PASSWORD`,
    ),
    requestTimeoutMs: 10_000,
    tlsCaFile: environment.CLICKHOUSE_TLS_CA_FILE?.trim() || undefined,
  };
}

const defaultDependencies: SignalBackfillCommandDependencies = {
  createDatabaseClient,
  closeDatabaseClient,
  readGuardEvidence: async (path) => await Bun.file(path).json(),
  write: (line) => console.log(line),
};

export async function runSignalBackfillFromCommand(
  argv: readonly string[],
  environment: SignalBackfillEnvironment = Bun.env,
  dependencies: SignalBackfillCommandDependencies = defaultDependencies,
): Promise<SignalBackfillResult> {
  const command = parseSignalBackfillCommand(argv);
  const telemetryUrl = postgresUrl(environment, 'TELEMETRY_DATABASE_URL');
  const logsUrl = postgresUrl(environment, 'LOG_DATABASE_URL');
  const controlUrl = postgresUrl(environment, 'OBSERVABILITY_DATABASE_URL');
  const readerOptions = clickHouseOptions(environment, 'READER');
  const writerOptions = clickHouseOptions(environment, 'WRITER');
  const telemetryDatabase = dependencies.createDatabaseClient(telemetryUrl);
  const logsDatabase = dependencies.createDatabaseClient(logsUrl);
  const controlDatabase = dependencies.createDatabaseClient(controlUrl);
  try {
    const reader = new ClickHouseClient(readerOptions);
    const target = new ClickHouseSignalBackfillTarget({
      writer: new ClickHouseClient(writerOptions),
      reader,
      maxThreads: command.maxThreads,
      maxMemoryBytes: command.maxMemoryBytes,
      maxWriteBytesPerSecond: command.maxWriteBytesPerSecond,
      parityPageSize: command.pageSize,
    });
    const guard = new ClickHouseSignalBackfillGuard({
      reader,
      evidence: async () =>
        await dependencies.readGuardEvidence(command.guardEvidencePath),
    });
    const result = await new SignalBackfillOrchestrator({
      control: new PostgresSignalBackfillControl({ controlDatabase }),
      source: new PostgresSignalBackfillSource({
        telemetryDatabase,
        logsDatabase,
        maxParityMemoryBytes: command.maxMemoryBytes,
      }),
      target,
      guard,
      pageSize: command.pageSize,
    }).run({ kind: command.kind, sourceDay: command.sourceDay });
    dependencies.write(
      JSON.stringify({
        runId: result.runId,
        status: result.status,
        sourceCount: result.sourceCount,
        targetCount: result.targetCount,
        errorCode: result.errorCode,
      }),
    );
    return result;
  } finally {
    await Promise.all([
      dependencies.closeDatabaseClient(telemetryDatabase),
      dependencies.closeDatabaseClient(logsDatabase),
      dependencies.closeDatabaseClient(controlDatabase),
    ]);
  }
}

export async function main(): Promise<void> {
  const result = await runSignalBackfillFromCommand(Bun.argv.slice(2));
  if (result.status === 'failed') process.exitCode = 1;
  if (result.status === 'paused') process.exitCode = 2;
}

if (import.meta.main) {
  main().catch(() => {
    console.error('Observability Signal backfill did not complete safely');
    process.exitCode = 1;
  });
}
