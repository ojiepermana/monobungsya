import { loadDatabaseToolConfig } from './config';
import { closeDatabaseClient, createDatabaseClient } from './index';
import { DatabaseRunner } from './runner';
import { type DatabaseScope, isDatabaseScope } from './tooling';

interface CliArguments {
  command: 'migrate' | 'seed' | 'reset' | 'down' | 'seed-reset';
  scope?: DatabaseScope;
  set?: 'reference' | 'fixtures';
  steps?: number;
  dryRun: boolean;
  confirm: boolean;
  seed: boolean;
}

export function parseCliArguments(argumentsList: string[]): CliArguments {
  const [command, ...flags] = argumentsList;

  if (
    command !== 'migrate' &&
    command !== 'seed' &&
    command !== 'reset' &&
    command !== 'down' &&
    command !== 'seed-reset'
  ) {
    throw new Error(
      'usage: migrate | seed | reset --confirm [--seed] | down [--steps N] | seed-reset --service NAME',
    );
  }

  let scope: DatabaseScope | undefined;
  let set: CliArguments['set'];
  let steps: number | undefined;
  let dryRun = false;
  let confirm = false;
  let seed = false;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];

    if (flag === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (flag === '--confirm') {
      confirm = true;
      continue;
    }

    if (flag === '--seed') {
      seed = true;
      continue;
    }

    if (flag === '--service') {
      const value = flags[++index];

      if (!value || !isDatabaseScope(value)) {
        throw new Error(
          `--service must be one of auth, access, user, logs, jobs`,
        );
      }

      scope = value;
      continue;
    }

    if (flag === '--set') {
      const value = flags[++index];

      if (value !== 'reference' && value !== 'fixtures') {
        throw new Error('--set must be reference or fixtures');
      }

      set = value;
      continue;
    }

    if (flag === '--steps') {
      const value = Number(flags[++index]);

      if (!Number.isInteger(value) || value <= 0) {
        throw new Error('--steps must be a positive integer');
      }

      steps = value;
      continue;
    }

    throw new Error(`unknown flag "${flag}"`);
  }

  if (command === 'reset' && (!confirm || scope !== undefined)) {
    throw new Error(
      'db:reset requires --confirm and does not accept --service',
    );
  }

  if (command === 'seed-reset' && scope === undefined) {
    throw new Error('db:seed:reset requires --service NAME');
  }

  if (command !== 'reset' && seed) {
    throw new Error('--seed is only valid with reset');
  }

  if (command !== 'seed' && set !== undefined) {
    throw new Error('--set is only valid with seed');
  }

  if (command !== 'migrate' && command !== 'seed' && dryRun) {
    throw new Error('--dry-run is only valid with migrate or seed');
  }

  return { command, scope, set, steps, dryRun, confirm, seed };
}

async function main(): Promise<void> {
  const argumentsList = Bun.argv.slice(2);
  const argumentsValue = parseCliArguments(argumentsList);
  const config = loadDatabaseToolConfig();
  const database = createDatabaseClient(config.migrationUrl);
  const runner = new DatabaseRunner(database, config);

  try {
    if (argumentsValue.command === 'migrate') {
      const result = await runner.migrate({
        scope: argumentsValue.scope,
        dryRun: argumentsValue.dryRun,
      });
      printResult(result);
      return;
    }

    if (argumentsValue.command === 'seed') {
      const result = await runner.seed({
        scope: argumentsValue.scope,
        set: argumentsValue.set,
        dryRun: argumentsValue.dryRun,
      });
      printResult(result);
      return;
    }

    if (argumentsValue.command === 'reset') {
      const result = await runner.reset({
        seed: argumentsValue.seed,
        confirm: argumentsValue.confirm,
      });
      printResult(result);
      return;
    }

    if (argumentsValue.command === 'down') {
      const result = await runner.migrateDown(
        argumentsValue.steps ?? 1,
        argumentsValue.scope,
      );
      for (const name of result.rolledBack) {
        console.log(`rolled back  ${name}`);
      }
      console.log(
        `database rollback complete (${result.rolledBack.length} migration(s))`,
      );
      return;
    }

    const result = await runner.resetSeed(
      argumentsValue.scope as DatabaseScope,
    );
    for (const name of result.cleared) {
      console.log(`cleared seed  ${name}`);
    }
    console.log(
      `seed tracking reset complete (${result.cleared.length} file(s))`,
    );
  } finally {
    await closeDatabaseClient(database);
  }
}

function printResult(result: unknown): void {
  if (Array.isArray(result)) {
    for (const file of result) {
      console.log(
        `${file.status.padEnd(18)} ${file.scope.padEnd(10)} ${file.name} ${file.checksum}`,
      );
    }

    if (result.some((file) => file.status === 'checksum-mismatch')) {
      process.exitCode = 1;
    }

    return;
  }

  if (
    typeof result === 'object' &&
    result !== null &&
    'applied' in result &&
    'skipped' in result
  ) {
    const typedResult = result as { applied: string[]; skipped: string[] };

    for (const name of typedResult.applied) {
      console.log(`applied  ${name}`);
    }

    for (const name of typedResult.skipped) {
      console.log(`skipped  ${name}`);
    }

    console.log(
      `database command complete (${typedResult.applied.length} applied, ${typedResult.skipped.length} skipped)`,
    );
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      `database command failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
