import { cpus, totalmem } from 'node:os';
import { v7 as uuidv7 } from 'uuid';
import type { DatabaseClient } from '#project/database';
import { createPostgresObservabilitySignalStore } from '#project/observability';
import {
  BENCHMARK_SCHEMA_VERSION,
  type BenchmarkBaseline,
  type BenchmarkDriverSnapshot,
  type BenchmarkMetricSnapshot,
  type BenchmarkOverhead,
  type BenchmarkReport,
  type BenchmarkValidity,
  reportChecksum as calculateReportChecksum,
  canonicalJson,
  compareBenchmark,
  overheadWithinPolicy,
  sha256,
  TelemetryRuntime,
} from '#project/telemetry';

interface Scenario {
  scenarioId: string;
  scenarioVersion: string;
  kind: 'journey' | 'microbenchmark' | 'throughput';
  runner?: string;
  fixtureVersion: string;
  instrumentationSchemaVersion: string;
  thresholdPolicyVersion: string;
  overheadPolicy: 'required' | 'diagnostic';
  warmupIterations: number;
  measuredIterations?: number;
  iterations?: number;
  timeoutMs?: number;
  tags?: string[];
  requiredResourceKinds?: string[];
  batchSize?: number;
  concurrencyLevels?: number[];
  operations: string[];
}

interface RawGroup {
  samples: number[];
  errorCount: number;
  operationCount: number;
  cpuMs: number;
  rssDeltaBytes: number;
  rssBytes: number;
  heapUsedBytes: number;
  eventLoopLagMs: number;
  elapsedMs: number;
}

type BenchmarkOperation = () => void | Promise<void>;

function argument(name: string): string | undefined {
  const index = Bun.argv.indexOf(`--${name}`);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000_000) {
    throw new Error('benchmark iteration values must be between 1 and 1000000');
  }
  return parsed;
}

function quantile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * fraction) - 1,
  );
  return sorted[Math.max(0, index)] ?? 0;
}

function median(values: number[]): number {
  return quantile(values, 0.5);
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return 0;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance) / Math.abs(mean);
}

function percentage(baseline: number, candidate: number): number {
  if (baseline === 0) return candidate === 0 ? 0 : 100;
  return ((candidate - baseline) / Math.abs(baseline)) * 100;
}

function branchName(): string | null {
  const environmentBranch =
    Bun.env.GITHUB_HEAD_REF || Bun.env.GITHUB_REF_NAME || undefined;
  if (environmentBranch) return environmentBranch;
  const output = Bun.spawnSync(['git', 'branch', '--show-current'], {
    stdout: 'pipe',
    stderr: 'ignore',
  });
  return new TextDecoder().decode(output.stdout).trim() || null;
}

function commitSha(): string {
  const output = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], {
    stdout: 'pipe',
    stderr: 'ignore',
  });
  return new TextDecoder().decode(output.stdout).trim() || 'working-tree';
}

async function loadScenario(
  path: string,
): Promise<{ scenario: Scenario; source: string }> {
  const source = await Bun.file(path).text();
  const scenario = JSON.parse(source) as Scenario;
  if (
    !scenario.scenarioId ||
    !['journey', 'microbenchmark', 'throughput'].includes(scenario.kind) ||
    (scenario.runner !== undefined && scenario.runner !== 'bun') ||
    !scenario.scenarioVersion ||
    !scenario.fixtureVersion ||
    !scenario.instrumentationSchemaVersion ||
    !scenario.thresholdPolicyVersion ||
    !['required', 'diagnostic'].includes(scenario.overheadPolicy) ||
    !Array.isArray(scenario.operations) ||
    scenario.operations.length === 0
  ) {
    throw new Error(`invalid benchmark scenario: ${path}`);
  }
  return { scenario, source };
}

function benchmarkSampleRate(): number {
  const configured = Number.parseFloat(
    Bun.env.BENCHMARK_SUCCESS_SAMPLE_RATE ?? '0.05',
  );
  return Number.isFinite(configured)
    ? Math.max(0, Math.min(1, configured))
    : 0.05;
}

function profile(): BenchmarkReport['runner']['runnerProfile'] {
  const hostCpus = cpus();
  const stagingTargetUrl = Bun.env.BENCHMARK_HTTP_URL?.trim();
  const stagingClass = Bun.env.BENCHMARK_STAGING_CLASS?.trim();
  const stagingOwnership = Bun.env.BENCHMARK_STAGING_OWNER?.trim();
  const stagingCleanupStateFile = Bun.env.BENCHMARK_STAGING_STATE_FILE?.trim();
  return {
    os: process.platform,
    arch: process.arch,
    cpuModel: hostCpus[0]?.model ?? 'unknown',
    coreCount: hostCpus.length,
    memoryBytes: totalmem(),
    bunVersion: Bun.version,
    networkClass: Bun.env.BENCHMARK_NETWORK_CLASS ?? 'local',
    successSampleRate: benchmarkSampleRate(),
    instrumentationMode:
      Bun.env.BENCHMARK_CAPTURE_TRACE === 'true'
        ? 'trace-capture'
        : 'production-sampling',
    ...(stagingClass ? { stagingClass } : {}),
    ...(stagingTargetUrl ? { stagingTargetUrl } : {}),
    ...(stagingOwnership ? { stagingOwnership } : {}),
    ...(stagingCleanupStateFile ? { stagingCleanupStateFile } : {}),
  };
}

async function measure(
  warmup: number,
  iterations: number,
  operation: BenchmarkOperation,
  batchSize = 1,
  beforeMeasured?: () => Promise<void>,
): Promise<RawGroup> {
  for (let index = 0; index < warmup; index += 1) {
    for (let batch = 0; batch < batchSize; batch += 1) await operation();
  }
  await beforeMeasured?.();
  const samples: number[] = [];
  let errorCount = 0;
  const cpuStart = process.cpuUsage();
  const memoryStart = process.memoryUsage();
  const rssStart = memoryStart.rss;
  let eventLoopLagMs = 0;
  const lagStarted = Bun.nanoseconds();
  const lagProbe = new Promise<void>((resolve) => {
    setTimeout(() => {
      eventLoopLagMs = Math.max(
        0,
        (Bun.nanoseconds() - lagStarted) / 1_000_000,
      );
      resolve();
    }, 0);
  });
  const wallStart = Bun.nanoseconds();
  const yieldEvery = Math.max(1, Math.floor(1_000 / batchSize));
  for (let index = 0; index < iterations; index += 1) {
    const started = Bun.nanoseconds();
    try {
      for (let batch = 0; batch < batchSize; batch += 1) {
        await operation();
      }
    } catch {
      errorCount += 1;
    }
    samples.push((Bun.nanoseconds() - started) / 1_000_000 / batchSize);
    if ((index + 1) % yieldEvery === 0) await Bun.sleep(0);
  }
  await lagProbe;
  const cpu = process.cpuUsage(cpuStart);
  const memoryEnd = process.memoryUsage();
  return {
    samples,
    errorCount,
    operationCount: iterations * batchSize,
    cpuMs: (cpu.user + cpu.system) / 1_000,
    rssDeltaBytes: memoryEnd.rss - rssStart,
    rssBytes: Math.max(rssStart, memoryEnd.rss),
    heapUsedBytes: Math.max(memoryStart.heapUsed, memoryEnd.heapUsed),
    eventLoopLagMs,
    elapsedMs: (Bun.nanoseconds() - wallStart) / 1_000_000,
  };
}

function metric(
  operation: string,
  groups: RawGroup[],
): BenchmarkMetricSnapshot {
  const samples = groups.flatMap((group) => group.samples);
  const groupP50 = groups.map((group) => quantile(group.samples, 0.5));
  const groupP95 = groups.map((group) => quantile(group.samples, 0.95));
  const groupP99 = groups.map((group) => quantile(group.samples, 0.99));
  const groupMean = groups.map(
    (group) =>
      group.samples.reduce((sum, value) => sum + value, 0) /
      Math.max(group.samples.length, 1),
  );
  return {
    resourceKind: 'business.operation',
    resourceName: `benchmark.${operation}`,
    unit: 'ms',
    operationCount: groups.reduce(
      (sum, group) => sum + group.operationCount,
      0,
    ),
    sampleCount: samples.length,
    p50: median(groupP50),
    p95: median(groupP95),
    p99: median(groupP99),
    mean: median(groupMean),
    min: Math.min(...samples),
    max: Math.max(...samples),
    errorCount: groups.reduce((sum, group) => sum + group.errorCount, 0),
    coefficientOfVariation: coefficientOfVariation(groupMean),
  };
}

function driverSnapshot(
  groups: RawGroup[],
  runnerCoreCount = 1,
): BenchmarkDriverSnapshot {
  const elapsedMs = groups.reduce((sum, group) => sum + group.elapsedMs, 0);
  const operationCount = groups.reduce(
    (sum, group) => sum + group.operationCount,
    0,
  );
  const cpuMs = groups.reduce((sum, group) => sum + group.cpuMs, 0);
  return {
    cpuMs,
    cpuUtilizationPercent:
      elapsedMs === 0
        ? 0
        : (cpuMs / elapsedMs / Math.max(1, runnerCoreCount)) * 100,
    rssBytes: Math.max(0, ...groups.map((group) => group.rssBytes)),
    heapUsedBytes: Math.max(0, ...groups.map((group) => group.heapUsedBytes)),
    eventLoopLagP95Ms: quantile(
      groups.map((group) => group.eventLoopLagMs),
      0.95,
    ),
    throughputPerSecond:
      elapsedMs === 0 ? 0 : operationCount / (elapsedMs / 1_000),
    errorCount: groups.reduce((sum, group) => sum + group.errorCount, 0),
    operationCount,
    elapsedMs,
  };
}

function scaleConcurrentGroup(group: RawGroup, concurrency: number): RawGroup {
  return {
    ...group,
    operationCount: group.operationCount * concurrency,
    errorCount: group.errorCount * concurrency,
  };
}

function benchmarkDatabase(): DatabaseClient {
  const transaction = {
    unsafe: async () => [],
    array: (values: unknown[], type: string) => ({ values, type }),
  };
  return {
    begin: async <T>(operation: (value: typeof transaction) => Promise<T>) =>
      operation(transaction),
  } as unknown as DatabaseClient;
}

function benchmarkQueueOptions(
  warmup: number,
  iterations: number,
  batchSize: number,
): { maxItems: number; maxBytes: number } {
  // The production queue is intentionally capped at 32 MiB. A benchmark
  // group, however, must be able to drain its bounded synthetic workload
  // before the next group starts; otherwise the byte cap measures fixture
  // saturation instead of instrumentation overhead. Keep the benchmark
  // queue bounded while reserving up to 1 KiB per item, with a hard ceiling.
  const maxItems = Math.max(2_000, (warmup + iterations) * batchSize * 2);
  const maxBytes = Math.min(
    512 * 1_024 * 1_024,
    Math.max(32 * 1_024 * 1_024, maxItems * 1_024),
  );
  return { maxItems, maxBytes };
}

async function drainRuntime(runtime: TelemetryRuntime): Promise<void> {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const result = await runtime.flush();
    if (
      runtime.diagnostics().queueDepth === 0 &&
      result.writtenMetricBuckets === 0
    ) {
      return;
    }
  }
  throw new Error('benchmark telemetry queue did not drain');
}

function targetUrl(path: string): string | null {
  const base = Bun.env.BENCHMARK_HTTP_URL?.trim();
  if (!base) return null;
  return new URL(path, base.endsWith('/') ? base : `${base}/`).toString();
}

function journeyPaths(): string[] {
  const configured = Bun.env.BENCHMARK_JOURNEY_STEPS?.trim();
  if (!configured) return ['/health'];
  return configured
    .split(',')
    .map((path) => path.trim())
    .filter((path) => path.startsWith('/') && path.length <= 120);
}

function spanSample(forceSample: boolean): boolean | undefined {
  return forceSample && Bun.env.BENCHMARK_CAPTURE_TRACE === 'true'
    ? true
    : undefined;
}

function inBenchmarkContext(
  runtime: TelemetryRuntime,
  operation: BenchmarkOperation,
): BenchmarkOperation {
  return () => runtime.withContext(runtime.extract({}), operation);
}

function httpOperation(
  runtime: TelemetryRuntime,
  path: string,
  forceSample: boolean,
): BenchmarkOperation {
  return async () => {
    const url = targetUrl(path);
    if (!url) throw new Error('benchmark target is not configured');
    const context = runtime.currentContext() ?? runtime.extract({});
    await runtime.withContext(context, () =>
      runtime.withSpan(
        {
          resourceKind: 'http.client',
          resourceName: 'benchmark.http',
          operation: 'request',
          forceSample: spanSample(forceSample),
        },
        async () => {
          const response = await fetch(url, {
            headers: {
              traceparent: runtime.inject(context).traceparent ?? '',
              'x-request-id': 'benchmark-driver',
              'x-correlation-id': 'benchmark-driver',
            },
          });
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error('benchmark target returned a non-success status');
          }
          await response.arrayBuffer();
        },
      ),
    );
  };
}

function operationFor(
  operation: string,
  runtime: TelemetryRuntime,
  forceSample = true,
): BenchmarkOperation {
  const validTraceparent =
    '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01';
  switch (operation) {
    case 'trace_context':
      return () => {
        const context = runtime.extract({ traceparent: validTraceparent });
        runtime.inject(context);
      };
    case 'span_lifecycle':
      return () => {
        runtime.withSpan(
          {
            resourceKind: 'business.operation',
            resourceName: 'benchmark.span',
            operation: 'measure',
            forceSample: spanSample(forceSample),
          },
          () => undefined,
        );
      };
    case 'metric_aggregation':
      return () => {
        runtime.addCounter('telemetry.operation.count', 1, {
          resource_kind: 'business.operation',
          resource_name: 'benchmark.metric',
        });
      };
    case 'histogram_aggregation':
      return () => {
        runtime.recordHistogram('telemetry.operation.duration_ns', 25, {
          resource_kind: 'business.operation',
          resource_name: 'benchmark.histogram',
        });
      };
    case 'queue_batching':
      return () => {
        runtime.withSpan(
          {
            resourceKind: 'business.operation',
            resourceName: 'benchmark.queue',
            operation: 'batch',
            forceSample: spanSample(forceSample),
          },
          () => undefined,
        );
      };
    case 'query_wrapper':
      return () => {
        runtime.withSpan(
          {
            resourceKind: 'db.query',
            resourceName: 'benchmark.query',
            operation: 'select',
            forceSample: spanSample(forceSample),
          },
          () => undefined,
        );
      };
    case 'nats_carrier':
      return () => {
        runtime.withSpan(
          {
            resourceKind: 'nats.publish',
            resourceName: 'benchmark.subject',
            operation: 'publish',
            forceSample: spanSample(forceSample),
          },
          () => {
            const context = runtime.extract({
              traceparent: validTraceparent,
            });
            runtime.inject(context, { correlationId: 'benchmark-correlation' });
            runtime.extract({
              traceparent: runtime.inject(context).traceparent,
            });
          },
        );
      };
    case 'sanitizer_boundary':
      return () => {
        runtime.withSpan(
          {
            resourceKind: 'business.operation',
            resourceName: 'benchmark.sanitizer',
            operation: 'sanitize',
            forceSample: spanSample(forceSample),
            attributes: {
              authorization: 'redacted',
              safe_attribute: 'bounded',
              long_attribute: 'x'.repeat(512),
            },
          },
          () => undefined,
        );
      };
    case 'context_propagation':
      return () => {
        const context = runtime.extract({ traceparent: validTraceparent });
        runtime.withContext(context, () => runtime.currentContext());
      };
    case 'span_lifecycle_error':
      return () => {
        try {
          runtime.withSpan(
            {
              resourceKind: 'business.operation',
              resourceName: 'benchmark.error',
              operation: 'error',
              forceSample: spanSample(forceSample),
            },
            () => {
              throw new Error('benchmark error');
            },
          );
        } catch {
          // The benchmark records the error path without leaking its message.
        }
      };
    case 'http_fetch':
      return httpOperation(runtime, '/health', forceSample);
    case 'journey_session_users':
      return async () => {
        await runtime.withSpan(
          {
            resourceKind: 'business.operation',
            resourceName: 'benchmark.session-users-journey',
            operation: 'journey',
            forceSample: spanSample(forceSample),
          },
          async () => {
            for (const path of journeyPaths()) {
              await httpOperation(runtime, path, forceSample)();
            }
          },
        );
      };
    default:
      throw new Error(`unsupported benchmark operation: ${operation}`);
  }
}

function baselineFromReport(report: BenchmarkReport): BenchmarkBaseline {
  return {
    baselineId: report.runId,
    scenario: report.scenario,
    approvedRunId: report.runId,
    fixtureVersion: report.scenario.fixtureVersion,
    environment: report.runner.environment,
    runnerProfile: report.runner.runnerProfile,
    instrumentationSchemaVersion: report.scenario.instrumentationSchemaVersion,
    thresholdPolicyVersion: report.scenario.thresholdPolicyVersion,
    approvalCommitSha: report.runner.commitSha,
    metricSnapshot: report.metrics,
    driverSnapshot: report.driver.instrumentationOn,
    promotedAt: report.finishedAt,
    active: true,
  };
}

function markdown(report: BenchmarkReport): string {
  const rows = Object.entries(report.metrics)
    .map(
      ([name, value]) =>
        `| ${name} | ${value.p50.toFixed(4)} | ${value.p95.toFixed(4)} | ${value.p99.toFixed(4)} | ${value.unit} |`,
    )
    .join('\n');
  return [
    `# Benchmark ${report.scenario.scenarioId}`,
    '',
    `Status: ${report.status}, comparison: ${report.comparisonStatus}`,
    '',
    `Commit: ${report.runner.commitSha}, Bun: ${report.runner.bunVersion}`,
    `Overhead policy: ${report.overhead.policy}`,
    `Overhead: latency ${report.overhead.latencyP95Percent?.toFixed(2) ?? 'n/a'}%, CPU ${report.overhead.cpuPercent?.toFixed(2) ?? 'n/a'}%, RSS ${report.overhead.rssPercent?.toFixed(2) ?? 'n/a'}%`,
    `Validity: ${report.validity.incompleteReasons.length === 0 ? 'complete' : report.validity.incompleteReasons.join(', ')}`,
    '',
    '| Metric | p50 | p95 | p99 | Unit |',
    '| --- | ---: | ---: | ---: | --- |',
    rows,
    '',
    `Checksum: ${report.reportChecksum}`,
    '',
  ].join('\n');
}

const scenarioPath =
  argument('scenario') ?? 'benchmarks/scenarios/runtime-telemetry.json';
const loaded = await loadScenario(scenarioPath);
const scenario = loaded.scenario;
const benchmarkEnvironment = Bun.env.BENCHMARK_ENVIRONMENT ?? 'local';
const warmup = positiveInteger(argument('warmup'), scenario.warmupIterations);
const iterations = positiveInteger(
  argument('iterations'),
  scenario.measuredIterations ?? scenario.iterations ?? 5_000,
);
const groups = positiveInteger(argument('groups'), 5);
const batchSize = positiveInteger(argument('batch'), scenario.batchSize ?? 1);
const startedAt = new Date().toISOString();
const runnerCoreCount = cpus().length;
const benchmarkSuccessSampleRate = benchmarkSampleRate();
const benchmarkFlushIntervalMs = 60_000;
const measurements: Record<string, BenchmarkMetricSnapshot> = {};
const latencyOverheads: number[] = [];
const onGroups: RawGroup[] = [];
const offGroups: RawGroup[] = [];
let droppedTelemetryCount = 0;
const throughputByConcurrency: Record<string, number> = {};
for (const operation of scenario.operations) {
  const queueOptions = benchmarkQueueOptions(warmup, iterations, batchSize);
  const runtime = new TelemetryRuntime({
    serviceName: 'benchmark-driver',
    serviceInstanceId: `benchmark-driver-${operation}`,
    enabled: true,
    signalStore: createPostgresObservabilitySignalStore({
      telemetryDatabase: benchmarkDatabase(),
      ...queueOptions,
      flushIntervalMs: benchmarkFlushIntervalMs,
    }),
    flushIntervalMs: benchmarkFlushIntervalMs,
    successSampleRate: benchmarkSuccessSampleRate,
  });
  const uninstrumentedRuntime = new TelemetryRuntime({
    serviceName: 'benchmark-driver',
    serviceInstanceId: `benchmark-driver-off-${operation}`,
    enabled: false,
  });
  const run = inBenchmarkContext(
    runtime,
    operationFor(operation, runtime, true),
  );
  const uninstrumentedRun = inBenchmarkContext(
    uninstrumentedRuntime,
    operationFor(operation, uninstrumentedRuntime, true),
  );
  const groupResults: RawGroup[] = [];
  const uninstrumentedGroups: RawGroup[] = [];
  for (let group = 0; group < groups; group += 1) {
    groupResults.push(
      await measure(warmup, iterations, run, batchSize, () =>
        drainRuntime(runtime),
      ),
    );
    await drainRuntime(runtime);
    uninstrumentedGroups.push(
      await measure(warmup, iterations, uninstrumentedRun, batchSize),
    );
  }
  onGroups.push(...groupResults);
  offGroups.push(...uninstrumentedGroups);
  measurements[operation] = metric(operation, groupResults);
  latencyOverheads.push(
    median(
      groupResults.map((group, index) =>
        percentage(
          quantile(uninstrumentedGroups[index]?.samples ?? [], 0.95),
          quantile(group.samples, 0.95),
        ),
      ),
    ),
  );
  droppedTelemetryCount += runtime.diagnostics().droppedItems;
  await runtime.shutdown();
  await uninstrumentedRuntime.shutdown();
}

if (scenario.kind === 'throughput' && Bun.env.BENCHMARK_HTTP_URL?.trim()) {
  const levels = Array.from(
    new Set(
      (scenario.concurrencyLevels ?? [1])
        .filter((value) => Number.isInteger(value) && value > 0)
        .map((value) => Math.min(value, 64)),
    ),
  ).sort((left, right) => left - right);
  for (const concurrency of levels) {
    const queueOptions = benchmarkQueueOptions(warmup, iterations, concurrency);
    const runtime = new TelemetryRuntime({
      serviceName: 'benchmark-driver',
      serviceInstanceId: `benchmark-throughput-${concurrency}`,
      enabled: true,
      signalStore: createPostgresObservabilitySignalStore({
        telemetryDatabase: benchmarkDatabase(),
        ...queueOptions,
        flushIntervalMs: benchmarkFlushIntervalMs,
      }),
      flushIntervalMs: benchmarkFlushIntervalMs,
      successSampleRate: benchmarkSuccessSampleRate,
    });
    const operation = inBenchmarkContext(
      runtime,
      operationFor('http_fetch', runtime, true),
    );
    const groupsAtConcurrency: RawGroup[] = [];
    for (let group = 0; group < groups; group += 1) {
      const result = await measure(
        warmup,
        iterations,
        async () => {
          await Promise.all(
            Array.from({ length: concurrency }, () => operation()),
          );
        },
        1,
        () => drainRuntime(runtime),
      );
      groupsAtConcurrency.push(scaleConcurrentGroup(result, concurrency));
      await drainRuntime(runtime);
    }
    throughputByConcurrency[String(concurrency)] = driverSnapshot(
      groupsAtConcurrency,
      runnerCoreCount,
    ).throughputPerSecond;
    droppedTelemetryCount += runtime.diagnostics().droppedItems;
    await runtime.shutdown();
  }
}

const finishedAt = new Date().toISOString();
const sourceChecksum = sha256(loaded.source);
const minimumObservations = scenario.kind === 'microbenchmark' ? 100 : 1;
const incompleteReasons: string[] = [];
if (iterations * groups < minimumObservations) {
  incompleteReasons.push(
    `fewer than ${minimumObservations} observations per metric`,
  );
}
if (droppedTelemetryCount > 0) incompleteReasons.push('telemetry dropped data');
const latencyOverheadPercent = median(latencyOverheads);
const driverOn = driverSnapshot(onGroups, runnerCoreCount);
const driverOff = driverSnapshot(offGroups, runnerCoreCount);
const cpuOverheadPercent = percentage(driverOff.cpuMs, driverOn.cpuMs);
const rssOverheadPercent = percentage(driverOff.rssBytes, driverOn.rssBytes);
const metricVariations = Object.values(measurements)
  .map((value) => value.coefficientOfVariation ?? 0)
  .filter(Number.isFinite);
const scenarioCoefficientOfVariation = metricVariations.length
  ? Math.max(...metricVariations)
  : null;
if (
  scenarioCoefficientOfVariation !== null &&
  scenarioCoefficientOfVariation > 0.1
) {
  incompleteReasons.push('coefficient of variation exceeds 10%');
}
if (driverOn.cpuUtilizationPercent > 80) {
  incompleteReasons.push('benchmark driver CPU utilization exceeds 80%');
}
if (driverOn.eventLoopLagP95Ms > 10) {
  incompleteReasons.push('benchmark driver event-loop lag p95 exceeds 10 ms');
}
if (driverOn.errorCount > 0) {
  incompleteReasons.push('benchmark operation errors occurred');
}
if (
  (scenario.kind === 'journey' || scenario.kind === 'throughput') &&
  !Bun.env.BENCHMARK_HTTP_URL?.trim()
) {
  incompleteReasons.push(
    'benchmark target is not configured for this scenario',
  );
}
if (
  benchmarkEnvironment === 'staging' &&
  (!Bun.env.BENCHMARK_HTTP_URL?.trim() ||
    !Bun.env.BENCHMARK_STAGING_CLASS?.trim() ||
    !Bun.env.BENCHMARK_STAGING_OWNER?.trim() ||
    !Bun.env.BENCHMARK_STAGING_STATE_FILE?.trim())
) {
  incompleteReasons.push(
    'staging runner profile is missing target, class, ownership, or cleanup state',
  );
}
const throughputEntries = Object.entries(throughputByConcurrency).sort(
  ([left], [right]) => Number(left) - Number(right),
);
for (let index = 0; index + 1 < throughputEntries.length; index += 1) {
  const current = throughputEntries[index];
  const next = throughputEntries[index + 1];
  if (current && next && current[1] > next[1] * 1.1) {
    incompleteReasons.push('throughput increased when concurrency was lowered');
    break;
  }
}
const overhead: BenchmarkOverhead = {
  policy: scenario.overheadPolicy,
  latencyP95Percent: latencyOverheadPercent,
  cpuPercent: cpuOverheadPercent,
  rssPercent: rssOverheadPercent,
  latencyLimitPercent: 5,
  cpuLimitPercent: 5,
  rssLimitPercent: 10,
  withinLimits:
    Number.isFinite(latencyOverheadPercent) &&
    Number.isFinite(cpuOverheadPercent) &&
    Number.isFinite(rssOverheadPercent)
      ? latencyOverheadPercent <= 5 &&
        cpuOverheadPercent <= 5 &&
        rssOverheadPercent <= 10
      : null,
};
if (scenario.overheadPolicy === 'required' && overhead.withinLimits === false) {
  incompleteReasons.push('instrumentation overhead exceeds limits');
} else if (
  scenario.overheadPolicy === 'required' &&
  overhead.withinLimits === null
) {
  incompleteReasons.push('instrumentation overhead could not be measured');
}
const validity: BenchmarkValidity = {
  observationCount: iterations * groups,
  minimumObservations,
  coefficientOfVariation: scenarioCoefficientOfVariation,
  driverCpuUtilizationPercent: driverOn.cpuUtilizationPercent,
  driverEventLoopLagP95Ms: driverOn.eventLoopLagP95Ms,
  throughputByConcurrency,
  incompleteReasons,
};
const reportWithoutChecksum: Omit<BenchmarkReport, 'reportChecksum'> = {
  schemaVersion: BENCHMARK_SCHEMA_VERSION,
  runId: uuidv7(),
  scenario: {
    scenarioId: scenario.scenarioId,
    scenarioVersion: scenario.scenarioVersion,
    kind: scenario.kind,
    overheadPolicy: scenario.overheadPolicy,
    fixtureVersion: scenario.fixtureVersion,
    instrumentationSchemaVersion: scenario.instrumentationSchemaVersion,
    thresholdPolicyVersion: scenario.thresholdPolicyVersion,
    manifestChecksum: sourceChecksum,
  },
  runner: {
    bunVersion: Bun.version,
    commitSha: commitSha(),
    branch: branchName(),
    environment: benchmarkEnvironment,
    runnerProfile: profile(),
  },
  source: {
    scenarioPath,
    scenarioChecksum: sourceChecksum,
    sourceChecksum,
  },
  startedAt,
  finishedAt,
  status: incompleteReasons.length > 0 ? 'incomplete' : 'completed',
  telemetryComplete: incompleteReasons.length === 0,
  droppedTelemetryCount,
  latencyOverheadPercent,
  cpuOverheadPercent,
  rssOverheadPercent,
  metrics: measurements,
  driver: {
    instrumentationOn: driverOn,
    instrumentationOff: driverOff,
  },
  validity,
  overhead,
  comparisons: [],
  comparisonStatus: 'not_comparable',
  artifactUri: null,
  traceUri: null,
  failureReason:
    incompleteReasons.length > 0 ? incompleteReasons.join('; ') : null,
};

let report = {
  ...reportWithoutChecksum,
  reportChecksum: calculateReportChecksum(reportWithoutChecksum),
} satisfies BenchmarkReport;

const baselinePath = argument('baseline');
if (baselinePath) {
  const baselineValue = JSON.parse(await Bun.file(baselinePath).text()) as
    | BenchmarkBaseline
    | BenchmarkReport;
  const baselineIsApprovedReport =
    !('metricSnapshot' in baselineValue) &&
    baselineValue.status === 'completed' &&
    baselineValue.telemetryComplete &&
    overheadWithinPolicy(baselineValue);
  const candidateIsComparable =
    report.status === 'completed' &&
    report.telemetryComplete &&
    overheadWithinPolicy(report) &&
    report.validity.incompleteReasons.length === 0;
  const comparison =
    candidateIsComparable &&
    ('metricSnapshot' in baselineValue || baselineIsApprovedReport)
      ? compareBenchmark(
          report,
          'metricSnapshot' in baselineValue
            ? baselineValue
            : baselineFromReport(baselineValue),
        )
      : { status: 'not_comparable' as const, comparisons: [] };
  const { reportChecksum: _reportChecksum, ...reportWithoutChecksum } = report;
  const reportWithComparison = {
    ...reportWithoutChecksum,
    comparisons: comparison.comparisons,
    comparisonStatus: comparison.status,
  } satisfies Omit<BenchmarkReport, 'reportChecksum'>;
  report = {
    ...reportWithComparison,
    reportChecksum: calculateReportChecksum(reportWithComparison),
  };
  if (comparison.status === 'fail') process.exitCode = 1;
}

const outputPath = argument('output');
if (outputPath)
  await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);
const markdownPath = argument('markdown');
if (markdownPath) await Bun.write(markdownPath, markdown(report));
console.log(canonicalJson(report));
