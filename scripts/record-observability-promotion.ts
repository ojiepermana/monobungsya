import {
  closeDatabaseClient,
  createDatabaseClient,
  type DatabaseClient,
} from '#project/database';
import {
  evaluateSignalPromotion,
  PostgresSignalPromotionControl,
  type RecordSignalPromotionInput,
  type SignalPromotionEvidence,
  type SignalPromotionReadMode,
  type SignalPromotionReport,
  type SignalPromotionStorageMode,
  type SignalPromotionWriteMode,
} from '#project/observability';

const ARGUMENT_NAMES = [
  'from-write-mode',
  'from-read-mode',
  'to-write-mode',
  'to-read-mode',
  'evidence',
  'artifact-uri',
  'actor-id',
] as const;

type PromotionArgumentName = (typeof ARGUMENT_NAMES)[number];

export interface PromotionRecordCommand {
  readonly from: SignalPromotionStorageMode;
  readonly to: SignalPromotionStorageMode;
  readonly evidencePath: string;
  readonly artifactUri: string;
  readonly actorId: string;
}

export type PromotionControlEnvironment = Readonly<
  Record<string, string | undefined>
>;

export interface PromotionRecordDependencies {
  readonly createDatabaseClient: (connectionString: string) => DatabaseClient;
  readonly closeDatabaseClient: (database: DatabaseClient) => Promise<void>;
  readonly readEvidence: (path: string) => Promise<unknown>;
  readonly now: () => Date;
  readonly write: (line: string) => void;
}

function usage(): string {
  return [
    'Usage: bun run observability:promotion:record --',
    '  --from-write-mode <postgres|dual|clickhouse>',
    '  --from-read-mode <postgres|clickhouse>',
    '  --to-write-mode <postgres|dual|clickhouse>',
    '  --to-read-mode <postgres|clickhouse>',
    '  --evidence <path-to-json>',
    '  --artifact-uri <absolute-uri>',
    '  --actor-id <operator-id>',
  ].join('\n');
}

function isArgumentName(value: string): value is PromotionArgumentName {
  return ARGUMENT_NAMES.some((name) => name === value);
}

function parseArguments(
  argv: readonly string[],
): Map<PromotionArgumentName, string> {
  const values = new Map<PromotionArgumentName, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument ?? ''}\n${usage()}`);
    }

    const name = argument.slice(2);
    if (!isArgumentName(name)) {
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

  for (const name of ARGUMENT_NAMES) {
    if (!values.has(name)) {
      throw new Error(`Missing required argument: --${name}\n${usage()}`);
    }
  }

  return values;
}

function requiredValue(
  values: ReadonlyMap<PromotionArgumentName, string>,
  name: PromotionArgumentName,
): string {
  const value = values.get(name)?.trim();
  if (!value) {
    throw new Error(`Argument --${name} must not be empty`);
  }
  return value;
}

function isWriteMode(value: string): value is SignalPromotionWriteMode {
  return value === 'postgres' || value === 'dual' || value === 'clickhouse';
}

function isReadMode(value: string): value is SignalPromotionReadMode {
  return value === 'postgres' || value === 'clickhouse';
}

function parseWriteMode(
  value: string,
  argument: string,
): SignalPromotionWriteMode {
  if (!isWriteMode(value)) {
    throw new Error(`${argument} must be one of: postgres, dual, clickhouse`);
  }
  return value;
}

function parseReadMode(
  value: string,
  argument: string,
): SignalPromotionReadMode {
  if (!isReadMode(value)) {
    throw new Error(`${argument} must be one of: postgres, clickhouse`);
  }
  return value;
}

function parseArtifactUri(value: string): string {
  try {
    const uri = new URL(value);
    if (!uri.protocol || uri.username || uri.password) {
      throw new Error('invalid URI');
    }
  } catch {
    throw new Error(
      '--artifact-uri must be an absolute URI without credentials',
    );
  }
  return value;
}

function parseActorId(value: string): string {
  if (value.length > 200) {
    throw new Error('--actor-id must be at most 200 characters');
  }
  if (
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  ) {
    throw new Error('--actor-id must not contain control characters');
  }
  return value;
}

export function parsePromotionRecordCommand(
  argv: readonly string[],
): PromotionRecordCommand {
  const values = parseArguments(argv);
  const artifactUri = parseArtifactUri(requiredValue(values, 'artifact-uri'));

  return {
    from: {
      writeMode: parseWriteMode(
        requiredValue(values, 'from-write-mode'),
        '--from-write-mode',
      ),
      readMode: parseReadMode(
        requiredValue(values, 'from-read-mode'),
        '--from-read-mode',
      ),
    },
    to: {
      writeMode: parseWriteMode(
        requiredValue(values, 'to-write-mode'),
        '--to-write-mode',
      ),
      readMode: parseReadMode(
        requiredValue(values, 'to-read-mode'),
        '--to-read-mode',
      ),
    },
    evidencePath: requiredValue(values, 'evidence'),
    artifactUri,
    actorId: parseActorId(requiredValue(values, 'actor-id')),
  };
}

export function observabilityControlDatabaseUrl(
  environment: PromotionControlEnvironment,
): string {
  const value = environment.OBSERVABILITY_DATABASE_URL?.trim();
  if (!value) {
    throw new Error(
      'OBSERVABILITY_DATABASE_URL is required to record a promotion report',
    );
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
      throw new Error('invalid PostgreSQL URL');
    }
  } catch {
    throw new Error('OBSERVABILITY_DATABASE_URL must be a PostgreSQL URL');
  }
  return value;
}

function evidenceFromJson(value: unknown): SignalPromotionEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('--evidence must contain a JSON object');
  }
  return value as SignalPromotionEvidence;
}

function evaluatedAt(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error('Operator clock did not provide a valid evaluation time');
  }
  return value.toISOString();
}

export function approvedPromotionRecordInput(
  command: PromotionRecordCommand,
  evidenceJson: unknown,
  now: () => Date,
): RecordSignalPromotionInput {
  const input: RecordSignalPromotionInput = {
    from: command.from,
    to: command.to,
    evaluatedAt: evaluatedAt(now),
    evidence: evidenceFromJson(evidenceJson),
    artifactUri: command.artifactUri,
    recordedBy: command.actorId,
  };
  const decision = evaluateSignalPromotion(input);
  if (!decision.allowed) {
    throw new Error(
      `Promotion evidence did not pass required gates: ${decision.failures.join(', ')}`,
    );
  }
  return input;
}

const defaultDependencies: PromotionRecordDependencies = {
  createDatabaseClient,
  closeDatabaseClient,
  readEvidence: async (path) => Bun.file(path).json(),
  now: () => new Date(),
  write: (line) => console.log(line),
};

function hasExpectedTarget(
  report: SignalPromotionReport,
  target: SignalPromotionStorageMode,
): boolean {
  return (
    report.decision.allowed === true &&
    report.to.writeMode === target.writeMode &&
    report.to.readMode === target.readMode
  );
}

/**
 * Records an immutable, already-approved promotion report. Validation happens
 * before opening the Control connection, so an incomplete report is never
 * persisted merely for diagnostic convenience.
 */
export async function recordPromotionFromCommand(
  argv: readonly string[],
  environment: PromotionControlEnvironment = Bun.env,
  dependencies: PromotionRecordDependencies = defaultDependencies,
): Promise<SignalPromotionReport> {
  const command = parsePromotionRecordCommand(argv);
  const controlDatabaseUrl = observabilityControlDatabaseUrl(environment);
  const evidence = await dependencies.readEvidence(command.evidencePath);
  const input = approvedPromotionRecordInput(
    command,
    evidence,
    dependencies.now,
  );

  const controlDatabase = dependencies.createDatabaseClient(controlDatabaseUrl);
  try {
    const control = new PostgresSignalPromotionControl({ controlDatabase });
    const report = await control.record(input);
    if (!hasExpectedTarget(report, input.to)) {
      throw new Error(
        'Control database returned a promotion report that was not approved for the requested target',
      );
    }

    dependencies.write(
      JSON.stringify({
        reportId: report.reportId,
        from: report.from,
        to: report.to,
        recordedAt: report.recordedAt,
      }),
    );
    return report;
  } finally {
    await dependencies.closeDatabaseClient(controlDatabase);
  }
}

export async function main(): Promise<void> {
  await recordPromotionFromCommand(Bun.argv.slice(2));
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
