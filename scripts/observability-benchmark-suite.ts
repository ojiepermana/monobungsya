import { mkdir } from 'node:fs/promises';
import { withBenchmarkStaging } from './observability-staging';

interface ImpactEntry {
  scenarioId: string;
  scenarioPath: string;
  baselinePath?: string;
  required: boolean;
}

interface ImpactMap {
  schemaVersion: string;
  scenarios: ImpactEntry[];
}

function argument(name: string): string | undefined {
  const index = Bun.argv.indexOf(`--${name}`);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

const impactMap = (await Bun.file(
  'benchmarks/impact-map.json',
).json()) as ImpactMap;
if (impactMap.schemaVersion !== '0014.1' || impactMap.scenarios.length === 0) {
  throw new Error('benchmarks/impact-map.json is empty or unsupported');
}

const full = Bun.argv.includes('--full');
const failOnIncomplete = Bun.argv.includes('--fail-on-incomplete');
const requireStaging = Bun.argv.includes('--require-staging');
const outputDirectory =
  argument('output-dir') ?? '/tmp/observability-benchmarks';
await mkdir(outputDirectory, { recursive: true });
const stagingStateFile = `${outputDirectory}/staging-state.json`;
const stagingOwner = `benchmark-suite:${process.pid}`;

const warmup = argument('warmup');
const iterations = argument('iterations');
const groups = argument('groups');
const entries = impactMap.scenarios.filter((entry) => full || entry.required);
const failures: string[] = [];
const reports: Array<{
  scenarioId: string;
  status: string;
  comparisonStatus: string;
  output: string;
}> = [];

const runSuite = async (): Promise<void> => {
  for (const entry of entries) {
    const output = `${outputDirectory}/${entry.scenarioId}.json`;
    const markdown = `${outputDirectory}/${entry.scenarioId}.md`;
    const args = [
      'run',
      'scripts/observability-benchmark.ts',
      '--scenario',
      entry.scenarioPath,
      '--output',
      output,
      '--markdown',
      markdown,
    ];
    if (warmup) args.push('--warmup', warmup);
    if (iterations) args.push('--iterations', iterations);
    if (groups) args.push('--groups', groups);
    if (entry.baselinePath) args.push('--baseline', entry.baselinePath);

    const child = Bun.spawn(['bun', ...args], {
      stdout: 'inherit',
      stderr: 'inherit',
      env: {
        ...Bun.env,
        BENCHMARK_STAGING_STATE_FILE: stagingStateFile,
        BENCHMARK_STAGING_OWNER: stagingOwner,
        BENCHMARK_STAGING_CLASS:
          Bun.env.BENCHMARK_STAGING_CLASS ??
          (requireStaging ? 'isolated' : 'local'),
        ...(Bun.env.BENCHMARK_HTTP_URL
          ? { BENCHMARK_HTTP_URL: Bun.env.BENCHMARK_HTTP_URL }
          : {}),
      },
    });
    const exitCode = await child.exited;
    const report = (await Bun.file(output)
      .json()
      .catch(() => null)) as {
      status?: string;
      comparisonStatus?: string;
    } | null;
    if (!report) {
      failures.push(`${entry.scenarioId} did not produce a report`);
      continue;
    }
    reports.push({
      scenarioId: entry.scenarioId,
      status: report.status ?? 'unknown',
      comparisonStatus: report.comparisonStatus ?? 'unknown',
      output,
    });
    if (exitCode !== 0)
      failures.push(`${entry.scenarioId} exited with ${exitCode}`);
    if (report.status === 'failed') failures.push(`${entry.scenarioId} failed`);
    if (failOnIncomplete && report.status === 'incomplete') {
      failures.push(`${entry.scenarioId} is incomplete`);
    }
  }
};

try {
  await withBenchmarkStaging(
    {
      createCommand: Bun.env.BENCHMARK_STAGING_CREATE_COMMAND,
      destroyCommand: Bun.env.BENCHMARK_STAGING_DESTROY_COMMAND,
      stateFile: `${outputDirectory}/staging-state.json`,
      targetUrl: Bun.env.BENCHMARK_HTTP_URL,
      requireTarget: requireStaging,
    },
    runSuite,
  );
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}

console.log(JSON.stringify({ full, reports, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
