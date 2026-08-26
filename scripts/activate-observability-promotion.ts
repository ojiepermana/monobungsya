import {
  closeDatabaseClient,
  createDatabaseClient,
  type DatabaseClient,
} from '#project/database';
import {
  type ActivateSignalStorageInput,
  PostgresSignalPromotionControl,
  type SignalPromotionReadMode,
  type SignalPromotionWriteMode,
  type SignalStorageActivation,
} from '#project/observability';
import {
  observabilityControlDatabaseUrl,
  type PromotionControlEnvironment,
} from './record-observability-promotion';

const REQUIRED_ARGUMENT_NAMES = [
  'from-write-mode',
  'from-read-mode',
  'to-write-mode',
  'to-read-mode',
  'actor-id',
] as const;
const OPTIONAL_ARGUMENT_NAMES = ['report-id'] as const;
const ALL_ARGUMENT_NAMES = [
  ...REQUIRED_ARGUMENT_NAMES,
  ...OPTIONAL_ARGUMENT_NAMES,
] as const;

type ActivationArgumentName = (typeof ALL_ARGUMENT_NAMES)[number];

export type PromotionActivationCommand = ActivateSignalStorageInput;

export interface PromotionActivationDependencies {
  readonly createDatabaseClient: (connectionString: string) => DatabaseClient;
  readonly closeDatabaseClient: (database: DatabaseClient) => Promise<void>;
  /** Test seam. Production intentionally uses the current wall clock. */
  readonly now?: () => Date;
  readonly write: (line: string) => void;
}

function usage(): string {
  return [
    'Usage: bun run observability:promotion:activate --',
    '  --from-write-mode <postgres|dual|clickhouse>',
    '  --from-read-mode <postgres|clickhouse>',
    '  --to-write-mode <postgres|dual|clickhouse>',
    '  --to-read-mode <postgres|clickhouse>',
    '  [--report-id <promotion-report-uuid>]',
    '  --actor-id <operator-id>',
  ].join('\n');
}

function isArgumentName(value: string): value is ActivationArgumentName {
  return ALL_ARGUMENT_NAMES.some((name) => name === value);
}

function parseArguments(
  argv: readonly string[],
): Map<ActivationArgumentName, string> {
  const values = new Map<ActivationArgumentName, string>();

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

  for (const name of REQUIRED_ARGUMENT_NAMES) {
    if (!values.has(name)) {
      throw new Error(`Missing required argument: --${name}\n${usage()}`);
    }
  }
  return values;
}

function requiredValue(
  values: ReadonlyMap<ActivationArgumentName, string>,
  name: ActivationArgumentName,
): string {
  const value = values.get(name)?.trim();
  if (!value) {
    throw new Error(`Argument --${name} must not be empty`);
  }
  return value;
}

function parseWriteMode(
  value: string,
  argument: string,
): SignalPromotionWriteMode {
  if (value === 'postgres' || value === 'dual' || value === 'clickhouse') {
    return value;
  }
  throw new Error(`${argument} must be one of: postgres, dual, clickhouse`);
}

function parseReadMode(
  value: string,
  argument: string,
): SignalPromotionReadMode {
  if (value === 'postgres' || value === 'clickhouse') return value;
  throw new Error(`${argument} must be one of: postgres, clickhouse`);
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

function parseReportId(value: string | undefined): string | null {
  if (value === undefined) return null;
  const reportId = value.trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      reportId,
    )
  ) {
    throw new Error('--report-id must be a UUID');
  }
  return reportId;
}

export function parsePromotionActivationCommand(
  argv: readonly string[],
): PromotionActivationCommand {
  const values = parseArguments(argv);
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
    reportId: parseReportId(values.get('report-id')),
    activatedBy: parseActorId(requiredValue(values, 'actor-id')),
  };
}

const defaultDependencies: PromotionActivationDependencies = {
  createDatabaseClient,
  closeDatabaseClient,
  write: (line) => console.log(line),
};

/** Records the next immutable Control state after validating the exact step. */
export async function activatePromotionFromCommand(
  argv: readonly string[],
  environment: PromotionControlEnvironment = Bun.env,
  dependencies: PromotionActivationDependencies = defaultDependencies,
): Promise<SignalStorageActivation> {
  const command = parsePromotionActivationCommand(argv);
  const controlDatabase = dependencies.createDatabaseClient(
    observabilityControlDatabaseUrl(environment),
  );
  try {
    const control = new PostgresSignalPromotionControl({
      controlDatabase,
      now: dependencies.now,
    });
    const activation = await control.activate(command);
    dependencies.write(
      JSON.stringify({
        activationId: activation.activationId,
        from: activation.from,
        to: activation.to,
        reportId: activation.reportId,
        activatedAt: activation.activatedAt,
        blindSpotSince: activation.blindSpotSince,
      }),
    );
    return activation;
  } finally {
    await dependencies.closeDatabaseClient(controlDatabase);
  }
}

export async function main(): Promise<void> {
  await activatePromotionFromCommand(Bun.argv.slice(2));
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
