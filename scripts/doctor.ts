import { stat } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';
import { SQL } from 'bun';

type PackageJson = {
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type DevTarget = {
  script: string;
  entrypoint: string;
  port: number;
};

const ROOT = resolve(import.meta.dir, '..');
const MINIMUM_BUN = [1, 4, 0] as const;
const DATABASE_URL_DEFAULT =
  'postgres://postgres:postgres@localhost:5432/project';
const NATS_URL_DEFAULT = 'nats://localhost:4222';
const DEV_TARGETS: DevTarget[] = [
  { script: 'dev:web', entrypoint: 'apps/web/angular.json', port: 4200 },
  {
    script: 'dev:gateway',
    entrypoint: 'apps/gateway/erp/src/main.ts',
    port: 3000,
  },
  {
    script: 'dev:auth',
    entrypoint: 'apps/services/auth/src/main.ts',
    port: 3101,
  },
  {
    script: 'dev:user',
    entrypoint: 'apps/services/user/src/main.ts',
    port: 3102,
  },
  {
    script: 'dev:logs',
    entrypoint: 'apps/services/logs/src/main.ts',
    port: 3103,
  },
  {
    script: 'dev:access',
    entrypoint: 'apps/services/access/src/main.ts',
    port: 3104,
  },
  {
    script: 'dev:jobs',
    entrypoint: 'apps/services/jobs/src/main.ts',
    port: 3105,
  },
  {
    script: 'dev:notification',
    entrypoint: 'apps/services/notification/src/main.ts',
    port: 3106,
  },
];
const DATABASE_SCHEMAS = [
  'auth',
  'access',
  'user',
  'logs',
  'jobs',
  'notification',
  'telemetry',
];
const TELEMETRY_TABLES = [
  'spans',
  'metric_buckets',
  'benchmark_runs',
  'benchmark_baselines',
  'benchmark_comparisons',
  'alert_states',
  'alert_rules',
  'ingestion_receipts',
];
const HTTP_ENV_DEFAULTS: Record<string, string> = {
  CORS_ORIGIN: 'http://localhost:4200',
  PUBLIC_API_URL: 'http://localhost:3000',
  WEB_APP_URL: 'http://localhost:4200',
  AUTH_SERVICE_URL: 'http://localhost:3101',
  USER_SERVICE_URL: 'http://localhost:3102',
  LOGS_SERVICE_URL: 'http://localhost:3103',
  ACCESS_SERVICE_URL: 'http://localhost:3104',
  JOBS_SERVICE_URL: 'http://localhost:3105',
  NOTIFICATION_SERVICE_URL: 'http://localhost:3106',
};

let failures = 0;
let warnings = 0;

function pass(message: string): void {
  console.log(`[ok] ${message}`);
}

function fail(message: string): void {
  failures += 1;
  console.error(`[error] ${message}`);
}

function warn(message: string): void {
  warnings += 1;
  console.warn(`[warn] ${message}`);
}

function info(message: string): void {
  console.log(`[info] ${message}`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function value(name: string, fallback?: string): string | undefined {
  const configured = Bun.env[name];
  return configured === undefined ? fallback : configured.trim();
}

function versionParts(version: string): number[] | undefined {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function meetsMinimumVersion(
  actual: number[],
  minimum: readonly number[],
): boolean {
  for (let index = 0; index < minimum.length; index += 1) {
    const actualPart = actual[index] ?? 0;
    const minimumPart = minimum[index] ?? 0;
    if (actualPart !== minimumPart) return actualPart > minimumPart;
  }
  return true;
}

function commandExists(command: string): boolean {
  const lookup =
    process.platform === 'win32'
      ? ['where', command]
      : ['sh', '-c', `command -v ${command}`];
  return Bun.spawnSync(lookup, { stderr: 'ignore' }).exitCode === 0;
}

function listeningPids(port: number): number[] {
  if (process.platform === 'win32') return [];

  const output = Bun.spawnSync(
    ['lsof', '-nP', '-ti', `tcp:${port}`, '-sTCP:LISTEN'],
    { stderr: 'ignore' },
  ).stdout.toString();

  return output
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function parseUrl(
  name: string,
  rawValue: string | undefined,
  protocols: readonly string[],
): URL | undefined {
  if (!rawValue) {
    fail(`${name} is empty`);
    return undefined;
  }

  try {
    const parsed = new URL(rawValue);
    if (!protocols.includes(parsed.protocol) || !parsed.hostname) {
      throw new Error('invalid protocol or hostname');
    }
    return parsed;
  } catch {
    fail(`${name} must be a valid ${protocols.join(' or ')} URL`);
    return undefined;
  }
}

function endpointLabel(parsed: URL): string {
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  const port = parsed.port ? `:${parsed.port}` : '';
  return `${parsed.protocol}//${hostname}${port}`;
}

function endpointPort(parsed: URL, fallback: number): number {
  return parsed.port ? Number(parsed.port) : fallback;
}

function validPort(
  name: string,
  rawValue: string | undefined,
  fallback: number,
): number | undefined {
  const parsed = Number(rawValue ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    fail(`${name} must be a valid TCP port`);
    return undefined;
  }
  return parsed;
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolveConnection) => {
    let settled = false;
    let socket: ReturnType<typeof createConnection>;

    const finish = (connected: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveConnection(connected);
    };

    try {
      socket = createConnection({ host, port });
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.setTimeout(3_000, () => finish(false));
    } catch {
      resolveConnection(false);
    }
  });
}

async function checkRuntime(): Promise<void> {
  const actual = versionParts(Bun.version);
  if (!actual || !meetsMinimumVersion(actual, MINIMUM_BUN)) {
    fail(`Bun ${Bun.version} is unsupported; Bun 1.4.0 or newer is required`);
  } else {
    pass(`Bun ${Bun.version}`);
  }

  const packagePath = join(ROOT, 'package.json');
  if (!(await pathExists(packagePath))) {
    fail('package.json is missing');
  }

  const lockfilePath = join(ROOT, 'bun.lock');
  if (await pathExists(lockfilePath)) {
    pass('bun.lock is present');
  } else {
    fail('bun.lock is missing; run bun install');
  }

  const envPath = join(ROOT, '.env');
  if (await pathExists(envPath)) {
    pass('.env is present');
  } else {
    warn(
      '.env is missing; Bun defaults will be used (copy .env.example for local configuration)',
    );
  }
}

async function readPackageJson(): Promise<PackageJson | undefined> {
  try {
    return (await Bun.file(join(ROOT, 'package.json')).json()) as PackageJson;
  } catch {
    fail('package.json cannot be read as JSON');
    return undefined;
  }
}

async function checkDependencies(packageJson: PackageJson): Promise<void> {
  const nodeModulesPath = join(ROOT, 'node_modules');
  if (!(await pathExists(nodeModulesPath))) {
    fail('node_modules is missing; run bun install before bun run dev');
    return;
  }
  pass('node_modules is present');

  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const missing: string[] = [];
  for (const dependency of Object.keys(dependencies)) {
    if (!(await pathExists(join(nodeModulesPath, dependency)))) {
      missing.push(dependency);
    }
  }

  if (missing.length > 0) {
    const shown = missing.slice(0, 8).join(', ');
    const suffix = missing.length > 8 ? `, and ${missing.length - 8} more` : '';
    fail(`missing installed dependencies: ${shown}${suffix}; run bun install`);
  } else {
    pass(
      `all ${Object.keys(dependencies).length} package dependencies are installed`,
    );
  }

  const angularCliPath = join(nodeModulesPath, '.bin', 'ng');
  if (await pathExists(angularCliPath)) {
    pass('Angular CLI binary is present');
  } else {
    fail('node_modules/.bin/ng is missing; the web dev server cannot start');
  }
}

async function checkDevStack(packageJson: PackageJson): Promise<void> {
  const scripts = packageJson.scripts ?? {};
  const devCommand = scripts.dev;
  if (!devCommand) {
    fail('package.json has no dev script');
    return;
  }

  for (const target of DEV_TARGETS) {
    if (!scripts[target.script]) {
      fail(`package.json is missing ${target.script}`);
    } else if (!devCommand.includes(target.script)) {
      fail(`dev does not start ${target.script}`);
    }

    if (await pathExists(join(ROOT, target.entrypoint))) {
      pass(`${target.script} entrypoint is present`);
    } else {
      fail(`${target.script} entrypoint is missing: ${target.entrypoint}`);
    }
  }
}

async function checkPorts(): Promise<void> {
  if (process.platform === 'win32') {
    if (commandExists('netstat'))
      pass('netstat is available for dev port inspection');
    else warn('netstat is unavailable; occupied dev ports cannot be inspected');
    return;
  }

  if (!commandExists('lsof')) {
    warn(
      'lsof is unavailable; occupied dev ports cannot be inspected or freed reliably',
    );
    return;
  }

  const occupied = DEV_TARGETS.flatMap((target) =>
    listeningPids(target.port).map((pid) => `${target.port} (pid ${pid})`),
  );
  if (occupied.length > 0) {
    warn(
      `dev ports are occupied: ${occupied.join(', ')}; bun run dev will try to stop them`,
    );
  } else {
    pass(
      `all dev ports are free: ${DEV_TARGETS.map((target) => target.port).join(', ')}`,
    );
  }
}

function checkHttpEnvironment(): void {
  for (const [name, fallback] of Object.entries(HTTP_ENV_DEFAULTS)) {
    const parsed = parseUrl(name, value(name, fallback), ['http:', 'https:']);
    if (parsed) pass(`${name} -> ${endpointLabel(parsed)}`);
  }
}

async function checkDatabase(
  connectionString: string,
): Promise<Set<string> | undefined> {
  let database: SQL | undefined;
  try {
    database = new SQL(connectionString, { connectionTimeout: 3 });
    const rows = (await database`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name = ANY(${database.array(DATABASE_SCHEMAS, 'text')})
    `) as Array<{ schema_name: string }>;
    return new Set(rows.map((row) => row.schema_name));
  } catch {
    return undefined;
  } finally {
    await database?.close({ timeout: 1 }).catch(() => undefined);
  }
}

async function checkTelemetryTables(
  connectionString: string,
): Promise<Set<string> | undefined> {
  let database: SQL | undefined;
  try {
    database = new SQL(connectionString, { connectionTimeout: 3 });
    const rows = (await database`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'telemetry'
        AND table_name = ANY(${database.array(TELEMETRY_TABLES, 'text')})
    `) as Array<{ table_name: string }>;
    return new Set(rows.map((row) => row.table_name));
  } catch {
    return undefined;
  } finally {
    await database?.close({ timeout: 1 }).catch(() => undefined);
  }
}

type TelemetryPartitionCheck = {
  spans_partitioned: boolean;
  metric_buckets_partitioned: boolean;
  spans_current_days: number;
  metric_buckets_current_days: number;
  maintenance_function: boolean;
};

async function checkTelemetryPartitions(
  connectionString: string,
): Promise<TelemetryPartitionCheck | undefined> {
  let database: SQL | undefined;
  try {
    database = new SQL(connectionString, { connectionTimeout: 3 });
    const [row] = (await database`
      SELECT
        EXISTS (
          SELECT 1
          FROM pg_class
          JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
          WHERE pg_namespace.nspname = 'telemetry'
            AND pg_class.relname = 'spans'
            AND pg_class.relkind = 'p'
        ) AS spans_partitioned,
        EXISTS (
          SELECT 1
          FROM pg_class
          JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
          WHERE pg_namespace.nspname = 'telemetry'
            AND pg_class.relname = 'metric_buckets'
            AND pg_class.relkind = 'p'
        ) AS metric_buckets_partitioned,
        (
          SELECT count(*)::int
          FROM pg_inherits
          JOIN pg_class AS parent ON parent.oid = pg_inherits.inhparent
          JOIN pg_class AS child ON child.oid = pg_inherits.inhrelid
          JOIN pg_namespace ON pg_namespace.oid = parent.relnamespace
          WHERE pg_namespace.nspname = 'telemetry'
            AND parent.relname = 'spans_' || to_char(CURRENT_DATE, 'YYYY')
            AND child.relname LIKE parent.relname || '_%'
        ) AS spans_current_days,
        (
          SELECT count(*)::int
          FROM pg_inherits
          JOIN pg_class AS parent ON parent.oid = pg_inherits.inhparent
          JOIN pg_class AS child ON child.oid = pg_inherits.inhrelid
          JOIN pg_namespace ON pg_namespace.oid = parent.relnamespace
          WHERE pg_namespace.nspname = 'telemetry'
            AND parent.relname = 'metric_buckets_' || to_char(CURRENT_DATE, 'YYYY')
            AND child.relname LIKE parent.relname || '_%'
        ) AS metric_buckets_current_days,
        to_regprocedure('telemetry.ensure_current_partitions()') IS NOT NULL
          AS maintenance_function
    `) as Array<TelemetryPartitionCheck>;
    return row;
  } catch {
    return undefined;
  } finally {
    await database?.close({ timeout: 1 }).catch(() => undefined);
  }
}

async function checkInfrastructure(): Promise<void> {
  const infrastructure = Bun.env.ENABLE_INFRASTRUCTURE;
  if (
    infrastructure !== undefined &&
    infrastructure !== 'true' &&
    infrastructure !== 'false'
  ) {
    fail('ENABLE_INFRASTRUCTURE must be exactly true or false');
    return;
  }

  if (infrastructure !== 'true') {
    info(
      'ENABLE_INFRASTRUCTURE=false; PostgreSQL, NATS, and SMTP checks are skipped',
    );
    return;
  }

  pass('ENABLE_INFRASTRUCTURE=true');

  if (!value('INTERNAL_AUTH_SIGNING_SECRET')) {
    fail(
      'INTERNAL_AUTH_SIGNING_SECRET is required when infrastructure is enabled',
    );
  } else {
    pass('internal auth signing secret is configured');
  }

  const totpKey = value('TOTP_ENCRYPTION_KEY');
  if (!totpKey || Buffer.from(totpKey, 'base64').length !== 32) {
    fail('TOTP_ENCRYPTION_KEY must be a base64 encoded 32 byte key');
  } else {
    pass('TOTP encryption key is configured');
  }

  const databaseString = value('DATABASE_URL') ?? DATABASE_URL_DEFAULT;
  const databaseUrl = parseUrl('DATABASE_URL', databaseString, [
    'postgres:',
    'postgresql:',
  ]);
  if (databaseUrl) {
    const schemas = await checkDatabase(databaseString);
    if (!schemas) {
      fail(
        `PostgreSQL is unreachable or rejected the connection at ${endpointLabel(databaseUrl)}`,
      );
    } else {
      pass(`PostgreSQL is reachable at ${endpointLabel(databaseUrl)}`);
      const missingSchemas = DATABASE_SCHEMAS.filter(
        (schema) => !schemas.has(schema),
      );
      if (missingSchemas.length > 0) {
        fail(
          `PostgreSQL is missing schemas: ${missingSchemas.join(', ')}; run bun run db:migrate`,
        );
      } else {
        pass(`database schemas are migrated: ${DATABASE_SCHEMAS.join(', ')}`);
        const telemetryTables = await checkTelemetryTables(databaseString);
        if (!telemetryTables) {
          fail('PostgreSQL telemetry schema cannot be inspected');
        } else {
          const missingTelemetryTables = TELEMETRY_TABLES.filter(
            (table) => !telemetryTables.has(table),
          );
          if (missingTelemetryTables.length > 0) {
            fail(
              `PostgreSQL telemetry tables are missing: ${missingTelemetryTables.join(', ')}; run bun run db:migrate -- --service logs`,
            );
          } else {
            pass(
              `telemetry tables are migrated: ${TELEMETRY_TABLES.join(', ')}`,
            );
            const telemetryPartitions =
              await checkTelemetryPartitions(databaseString);
            if (!telemetryPartitions) {
              fail('PostgreSQL telemetry partitions cannot be inspected');
            } else if (
              !telemetryPartitions.spans_partitioned ||
              !telemetryPartitions.metric_buckets_partitioned ||
              telemetryPartitions.spans_current_days < 365 ||
              telemetryPartitions.metric_buckets_current_days < 365 ||
              !telemetryPartitions.maintenance_function
            ) {
              fail(
                'PostgreSQL telemetry daily partitions or maintenance function are incomplete; run bun run db:migrate -- --service logs',
              );
            } else {
              pass(
                `telemetry daily partitions are ready for the current year (${telemetryPartitions.spans_current_days} spans days, ${telemetryPartitions.metric_buckets_current_days} metric days)`,
              );
              pass('telemetry partition maintenance function is present');
            }
          }
        }
      }
    }
  }

  const migrationString = value('DATABASE_MIGRATION_URL');
  if (!migrationString) {
    warn('DATABASE_MIGRATION_URL is missing; bun run db:migrate cannot run');
  } else if (
    parseUrl('DATABASE_MIGRATION_URL', migrationString, [
      'postgres:',
      'postgresql:',
    ])
  ) {
    pass('DATABASE_MIGRATION_URL is valid');
  }

  const logDatabaseString = value('LOG_DATABASE_URL') || databaseString;
  const logDatabaseUrl = parseUrl('LOG_DATABASE_URL', logDatabaseString, [
    'postgres:',
    'postgresql:',
  ]);
  if (logDatabaseUrl && logDatabaseString !== databaseString) {
    if (await checkDatabase(logDatabaseString)) {
      pass(
        `logging PostgreSQL is reachable at ${endpointLabel(logDatabaseUrl)}`,
      );
    } else {
      fail(
        `logging PostgreSQL is unreachable at ${endpointLabel(logDatabaseUrl)}`,
      );
    }
  }

  const natsUrl = parseUrl('NATS_URL', value('NATS_URL', NATS_URL_DEFAULT), [
    'nats:',
    'tls:',
  ]);
  if (natsUrl) {
    const connected = await canConnect(
      natsUrl.hostname.replace(/^\[|\]$/g, ''),
      endpointPort(natsUrl, 4222),
    );
    if (connected) pass(`NATS is reachable at ${endpointLabel(natsUrl)}`);
    else
      warn(
        `NATS is unavailable at ${endpointLabel(natsUrl)}; event delivery will be skipped`,
      );
  }

  const smtpHost = value('SMTP_HOST', '127.0.0.1');
  const smtpPort = validPort('SMTP_PORT', value('SMTP_PORT'), 2525);
  if (smtpHost && smtpPort) {
    const connected = await canConnect(smtpHost, smtpPort);
    if (connected) pass(`SMTP is reachable at ${smtpHost}:${smtpPort}`);
    else
      warn(
        `SMTP is unavailable at ${smtpHost}:${smtpPort}; auth emails will not be delivered`,
      );
  }
}

async function main(): Promise<void> {
  console.log('Monobungsia doctor');
  console.log('==================');

  await checkRuntime();
  const packageJson = await readPackageJson();
  if (packageJson) {
    const packageManager = packageJson.packageManager;
    if (packageManager?.startsWith('bun@'))
      pass(`package manager: ${packageManager}`);
    else fail('package.json must declare Bun as its package manager');
    await checkDependencies(packageJson);
    await checkDevStack(packageJson);
  }

  await checkPorts();
  checkHttpEnvironment();
  await checkInfrastructure();

  console.log('\nSummary');
  if (failures > 0) {
    console.error(
      `${failures} error(s), ${warnings} warning(s). Fix errors before bun run dev.`,
    );
    process.exitCode = 1;
  } else if (warnings > 0) {
    console.log(`Ready to run bun run dev with ${warnings} warning(s).`);
  } else {
    console.log('All checks passed. Ready to run bun run dev.');
  }
}

await main();
