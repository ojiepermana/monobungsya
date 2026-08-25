import { mkdir, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  BENCHMARK_SCHEMA_VERSION,
  type BenchmarkReport,
  canonicalJson,
  selectCalibrationMedoid,
} from '#project/telemetry';

function argument(name: string): string | undefined {
  const index = Bun.argv.indexOf(`--${name}`);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

function isReport(value: unknown): value is BenchmarkReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const report = value as Partial<BenchmarkReport>;
  const scenario = report.scenario;
  const runner = report.runner;
  const metrics = report.metrics;
  const driver = report.driver;
  const validity = report.validity;
  const overhead = report.overhead;
  return (
    report.schemaVersion === BENCHMARK_SCHEMA_VERSION &&
    typeof report.runId === 'string' &&
    typeof report.reportChecksum === 'string' &&
    Boolean(scenario) &&
    typeof scenario === 'object' &&
    Boolean(runner) &&
    typeof runner === 'object' &&
    Boolean(metrics) &&
    typeof metrics === 'object' &&
    Boolean(driver) &&
    typeof driver === 'object' &&
    Boolean(validity) &&
    typeof validity === 'object' &&
    Boolean(overhead) &&
    typeof overhead === 'object'
  );
}

const inputDirectory = argument('input-dir');
if (!inputDirectory) {
  throw new Error(
    'calibration requires --input-dir containing benchmark JSON reports',
  );
}

const outputPath =
  argument('output') ?? '/tmp/observability-benchmark-calibration.json';
const files = (await readdir(inputDirectory))
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => `${inputDirectory}/${file}`);
const reports: BenchmarkReport[] = [];
const invalidFiles: string[] = [];

for (const file of files) {
  try {
    const value = await Bun.file(file).json();
    if (!isReport(value)) {
      invalidFiles.push(file);
      continue;
    }
    reports.push(value);
  } catch {
    invalidFiles.push(file);
  }
}

const result = invalidFiles.length
  ? {
      valid: false,
      reason: `calibration input contains invalid report files: ${invalidFiles.join(', ')}`,
      medoid: null,
    }
  : selectCalibrationMedoid(reports);
const artifact = {
  schemaVersion: BENCHMARK_SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  inputDirectory,
  reportCount: reports.length,
  valid: result.valid,
  reason: result.reason,
  medoidRunId: result.medoid?.runId ?? null,
  medoid: result.medoid,
};

await mkdir(dirname(outputPath), { recursive: true });
await Bun.write(outputPath, `${canonicalJson(artifact)}\n`);
console.log(JSON.stringify(artifact, null, 2));
if (!result.valid) process.exitCode = 1;
