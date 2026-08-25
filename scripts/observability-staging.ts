import { mkdir } from 'node:fs/promises';

export interface BenchmarkStagingOptions {
  createCommand?: string;
  destroyCommand?: string;
  stateFile: string;
  targetUrl?: string;
  requireTarget?: boolean;
}

async function runCommand(
  command: string,
  options: BenchmarkStagingOptions,
  phase: 'create' | 'destroy',
): Promise<void> {
  const child = Bun.spawn(['sh', '-lc', command], {
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...Bun.env,
      BENCHMARK_STAGING_STATE_FILE: options.stateFile,
      BENCHMARK_HTTP_URL: options.targetUrl ?? Bun.env.BENCHMARK_HTTP_URL ?? '',
    },
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(
      `benchmark staging ${phase} command exited with ${exitCode}`,
    );
  }
}

export async function withBenchmarkStaging<T>(
  options: BenchmarkStagingOptions,
  operation: () => Promise<T>,
): Promise<T> {
  const createCommand = options.createCommand?.trim();
  const destroyCommand = options.destroyCommand?.trim();
  const targetUrl =
    options.targetUrl?.trim() || Bun.env.BENCHMARK_HTTP_URL?.trim();
  if (
    options.requireTarget &&
    (!createCommand || !destroyCommand || !targetUrl)
  ) {
    throw new Error(
      'required benchmark staging needs create and destroy commands plus BENCHMARK_HTTP_URL',
    );
  }

  await mkdir(options.stateFile.split('/').slice(0, -1).join('/') || '.', {
    recursive: true,
  });
  let createAttempted = false;
  try {
    if (createCommand) {
      createAttempted = true;
      await runCommand(createCommand, { ...options, targetUrl }, 'create');
    }
    return await operation();
  } finally {
    if (createAttempted && destroyCommand) {
      await runCommand(destroyCommand, { ...options, targetUrl }, 'destroy');
    }
  }
}
