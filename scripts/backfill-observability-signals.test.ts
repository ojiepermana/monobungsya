import { describe, expect, test } from 'bun:test';
import {
  parseSignalBackfillCommand,
  runSignalBackfillFromCommand,
} from './backfill-observability-signals';

function argumentsFor(overrides: readonly string[] = []): string[] {
  return [
    '--execute',
    '--confirm-retained-postgres',
    '--kind',
    'application_log',
    '--source-day',
    '2026-08-25',
    '--max-threads',
    '4',
    '--host-cpu-threads',
    '16',
    '--max-memory-bytes',
    '268435456',
    '--host-memory-bytes',
    '1073741824',
    '--max-write-bytes-per-second',
    '10485760',
    '--measured-disk-write-bytes-per-second',
    '104857600',
    '--guard-evidence',
    '/protected/current-window.json',
    ...overrides,
  ];
}

describe('observability backfill command', () => {
  test('requires both explicit write confirmations and a bounded resource budget', async () => {
    await expect(
      Promise.resolve().then(() =>
        parseSignalBackfillCommand(
          argumentsFor().filter(
            (value) => value !== '--confirm-retained-postgres',
          ),
        ),
      ),
    ).rejects.toThrow('--confirm-retained-postgres is required');

    expect(parseSignalBackfillCommand(argumentsFor())).toMatchObject({
      kind: 'application_log',
      sourceDay: '2026-08-25',
      maxThreads: 4,
      hostCpuThreads: 16,
      maxMemoryBytes: 268_435_456,
      hostMemoryBytes: 1_073_741_824,
      maxWriteBytesPerSecond: 10_485_760,
      measuredDiskWriteBytesPerSecond: 104_857_600,
    });
  });

  test('rejects a CPU setting above the 30 percent worker budget', () => {
    const argv = argumentsFor();
    const index = argv.indexOf('4');
    argv[index] = '5';

    expect(() => parseSignalBackfillCommand(argv)).toThrow(
      '--max-threads must not exceed 30 percent of host CPU threads',
    );
  });

  test('rejects memory and disk caps above 30 percent of operator evidence', () => {
    const memory = argumentsFor();
    memory[memory.indexOf('268435456')] = '322122548';
    expect(() => parseSignalBackfillCommand(memory)).toThrow(
      '--max-memory-bytes must not exceed 30 percent of host memory bytes',
    );

    const disk = argumentsFor();
    disk[disk.indexOf('10485760')] = '31457281';
    expect(() => parseSignalBackfillCommand(disk)).toThrow(
      '--max-write-bytes-per-second must not exceed 30 percent of measured disk write bytes per second',
    );
  });

  test('fixes the deterministic parity sampling rule at one in one thousand', () => {
    expect(() =>
      parseSignalBackfillCommand([...argumentsFor(), '--sample-modulus', '10']),
    ).toThrow('Unknown argument: --sample-modulus');
  });

  test('validates every credential before it opens a source database', async () => {
    let opened = 0;

    await expect(
      runSignalBackfillFromCommand(
        argumentsFor(),
        {
          TELEMETRY_DATABASE_URL: 'postgres://telemetry.example/project',
          LOG_DATABASE_URL: 'postgres://logs.example/project',
          OBSERVABILITY_DATABASE_URL: 'postgres://control.example/project',
          CLICKHOUSE_URL: 'https://clickhouse.example:8443',
        },
        {
          createDatabaseClient: () => {
            opened += 1;
            return {} as never;
          },
          closeDatabaseClient: async () => undefined,
          readGuardEvidence: async () => ({}),
          write: () => undefined,
        },
      ),
    ).rejects.toThrow('CLICKHOUSE_READER_USERNAME is required');
    expect(opened).toBe(0);
  });
});
