import {
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '#project/errors';
import {
  type BenchmarkReport,
  METRIC_NAMES,
  reportChecksum,
} from '#project/telemetry';
import type { VerifiedIngestion } from './observability.ingestion';
import {
  decodeAlertCursor,
  decodeBaselineCursor,
  decodeBenchmarkCursor,
  decodeTraceCursor,
  METRIC_STEPS,
  type ObservabilityRepository,
} from './observability.repository';
import type {
  AlertQuery,
  BenchmarkBaselineQuery,
  BenchmarkRunQuery,
  MetricGroup,
  MetricQuery,
  TraceQuery,
} from './observability.types';
import { METRIC_GROUPS } from './observability.types';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const STORAGE_BLIND_SPOT = 'observability_storage_blind_spot';
function parseTime(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(
      'Observability time filters must be valid ISO timestamps',
    );
  }
  return parsed;
}

function range(
  fromValue: string | undefined,
  toValue: string | undefined,
  maxMs: number,
): { from: Date; to: Date } {
  const to = parseTime(toValue, new Date());
  const from = parseTime(fromValue, new Date(to.getTime() - HOUR_MS));
  if (from >= to || to.getTime() - from.getTime() > maxMs) {
    throw new ValidationError(
      'Observability time range is invalid or exceeds the maximum window',
    );
  }
  return { from, to };
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function metricGroups(value: string | undefined): MetricGroup[] {
  if (!value) return [];
  const groups = value
    .split(',')
    .map((group) => group.trim())
    .filter(Boolean);
  if (
    groups.length === 0 ||
    groups.length > METRIC_GROUPS.length ||
    new Set(groups).size !== groups.length ||
    groups.some(
      (group): group is string => !METRIC_GROUPS.includes(group as MetricGroup),
    )
  ) {
    throw new ValidationError(
      `Metric group must use only ${METRIC_GROUPS.join(', ')}`,
    );
  }
  return groups as MetricGroup[];
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validDriver(value: unknown): boolean {
  if (!record(value)) return false;
  return [
    'cpuMs',
    'cpuUtilizationPercent',
    'rssBytes',
    'heapUsedBytes',
    'eventLoopLagP95Ms',
    'throughputPerSecond',
    'errorCount',
    'operationCount',
    'elapsedMs',
  ].every((key) => nonNegativeFinite(value[key]));
}

function validMetric(value: unknown): boolean {
  if (!record(value)) return false;
  return (
    typeof value.resourceKind === 'string' &&
    typeof value.resourceName === 'string' &&
    typeof value.unit === 'string' &&
    nonNegativeFinite(value.operationCount) &&
    nonNegativeFinite(value.p50) &&
    nonNegativeFinite(value.p95) &&
    nonNegativeFinite(value.p99) &&
    nonNegativeFinite(value.mean) &&
    nonNegativeFinite(value.min) &&
    nonNegativeFinite(value.max) &&
    nonNegativeFinite(value.errorCount) &&
    (value.sampleCount === undefined || nonNegativeFinite(value.sampleCount)) &&
    (value.coefficientOfVariation === undefined ||
      nonNegativeFinite(value.coefficientOfVariation))
  );
}

function validBenchmarkDocument(report: Partial<BenchmarkReport>): boolean {
  const runnerProfile = record(report.runner?.runnerProfile)
    ? report.runner.runnerProfile
    : ({} as Record<string, unknown>);
  if (
    !record(report.scenario) ||
    !['journey', 'microbenchmark', 'throughput'].includes(
      String(report.scenario.kind),
    ) ||
    typeof report.scenario.scenarioId !== 'string' ||
    typeof report.scenario.scenarioVersion !== 'string' ||
    typeof report.scenario.fixtureVersion !== 'string' ||
    typeof report.scenario.instrumentationSchemaVersion !== 'string' ||
    typeof report.scenario.thresholdPolicyVersion !== 'string' ||
    !['required', 'diagnostic'].includes(
      String(report.scenario.overheadPolicy),
    ) ||
    typeof report.scenario.manifestChecksum !== 'string' ||
    !record(report.runner) ||
    typeof report.runner.bunVersion !== 'string' ||
    typeof report.runner.commitSha !== 'string' ||
    (report.runner.branch !== null &&
      report.runner.branch !== undefined &&
      typeof report.runner.branch !== 'string') ||
    typeof report.runner.environment !== 'string' ||
    !record(report.runner.runnerProfile) ||
    typeof runnerProfile.os !== 'string' ||
    typeof runnerProfile.arch !== 'string' ||
    typeof runnerProfile.cpuModel !== 'string' ||
    typeof runnerProfile.coreCount !== 'number' ||
    !Number.isInteger(runnerProfile.coreCount) ||
    runnerProfile.coreCount < 1 ||
    !nonNegativeFinite(runnerProfile.memoryBytes) ||
    typeof runnerProfile.networkClass !== 'string' ||
    !nonNegativeFinite(runnerProfile.successSampleRate) ||
    runnerProfile.successSampleRate > 1 ||
    (runnerProfile.instrumentationMode !== undefined &&
      runnerProfile.instrumentationMode !== 'production-sampling' &&
      runnerProfile.instrumentationMode !== 'trace-capture') ||
    (report.runner.environment === 'staging' &&
      (typeof runnerProfile.stagingClass !== 'string' ||
        typeof runnerProfile.stagingTargetUrl !== 'string' ||
        typeof runnerProfile.stagingOwnership !== 'string' ||
        typeof runnerProfile.stagingCleanupStateFile !== 'string')) ||
    !validDriver(report.driver?.instrumentationOn) ||
    !validDriver(report.driver?.instrumentationOff) ||
    !record(report.validity) ||
    !Number.isInteger(report.validity.observationCount) ||
    report.validity.observationCount < 0 ||
    !Number.isInteger(report.validity.minimumObservations) ||
    report.validity.minimumObservations < 1 ||
    (report.validity.coefficientOfVariation !== null &&
      !nonNegativeFinite(report.validity.coefficientOfVariation)) ||
    !Number.isFinite(report.validity.driverCpuUtilizationPercent) ||
    !Number.isFinite(report.validity.driverEventLoopLagP95Ms) ||
    !record(report.validity.throughputByConcurrency) ||
    !Array.isArray(report.validity.incompleteReasons) ||
    !report.validity.incompleteReasons.every(
      (reason) => typeof reason === 'string',
    ) ||
    !record(report.overhead) ||
    ![
      report.overhead.latencyP95Percent,
      report.overhead.cpuPercent,
      report.overhead.rssPercent,
    ].every((value) => value === null || Number.isFinite(value)) ||
    !nonNegativeFinite(report.overhead.latencyLimitPercent) ||
    !nonNegativeFinite(report.overhead.cpuLimitPercent) ||
    !nonNegativeFinite(report.overhead.rssLimitPercent) ||
    !['required', 'diagnostic'].includes(String(report.overhead.policy)) ||
    (report.overhead.withinLimits !== null &&
      typeof report.overhead.withinLimits !== 'boolean')
  ) {
    return false;
  }
  return Object.values(report.metrics as Record<string, unknown>).every(
    validMetric,
  );
}

export class ObservabilityService {
  constructor(private readonly repository: ObservabilityRepository) {}

  async ingestBenchmark(value: unknown, receipt: VerifiedIngestion) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ValidationError('Benchmark ingestion must be a JSON object');
    }
    const report = value as Partial<BenchmarkReport>;
    if (
      report.schemaVersion !== '0014.1' ||
      typeof report.runId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(report.runId) ||
      !report.scenario ||
      typeof report.scenario !== 'object' ||
      !report.runner ||
      typeof report.runner !== 'object' ||
      !report.source ||
      typeof report.source !== 'object' ||
      !report.metrics ||
      typeof report.metrics !== 'object' ||
      !Array.isArray(report.comparisons) ||
      !['completed', 'failed', 'incomplete'].includes(String(report.status)) ||
      typeof report.telemetryComplete !== 'boolean' ||
      !nonNegativeFinite(report.droppedTelemetryCount) ||
      !validBenchmarkDocument(report) ||
      typeof report.reportChecksum !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(report.reportChecksum)
    ) {
      throw new ValidationError('Benchmark ingestion document is invalid');
    }
    const { reportChecksum: receivedChecksum, ...reportWithoutChecksum } =
      report as BenchmarkReport;
    if (reportChecksum(reportWithoutChecksum) !== receivedChecksum) {
      throw new ValidationError('Benchmark ingestion checksum is invalid');
    }
    if (
      Object.keys(report.metrics).length > 200 ||
      report.comparisons.length > 2_000
    ) {
      throw new ValidationError(
        'Benchmark ingestion document contains too many metrics',
      );
    }
    return this.repository.ingestBenchmark(report as BenchmarkReport, receipt);
  }

  async listTraces(query: TraceQuery) {
    if (query.cursor) {
      try {
        decodeTraceCursor(query.cursor);
      } catch {
        throw new ValidationError('The trace cursor is invalid');
      }
    }
    const times = range(query.from, query.to, DAY_MS);
    const page = await this.readWithBlindSpot(
      () =>
        this.repository.listTraces({
          ...times,
          cursor: query.cursor,
          service: clean(query.service),
          resourceKind: clean(query.resourceKind),
          resourceName: clean(query.resourceName),
          status: clean(query.status) as TraceQuery['status'],
          correlationId: clean(query.correlationId),
          requestId: clean(query.requestId),
          runId: clean(query.runId),
        }),
      {
        items: [],
        prevCursor: null,
        nextCursor: null,
        options: { services: [], resourceKinds: [], resourceNames: [] },
        storageStatus: 'blind_spot',
      },
    );
    const completeness: 'complete' | 'partial' = page.items.every(
      (item) => item.complete,
    )
      ? 'complete'
      : 'partial';
    return {
      data: page.items,
      prevCursor: page.prevCursor,
      nextCursor: page.nextCursor,
      options: page.options,
      completeness:
        page.storageStatus === 'blind_spot' ? 'partial' : completeness,
      storageStatus: page.storageStatus,
    };
  }

  async getTrace(traceId: string) {
    this.requireStorage();
    const detail = await this.readDetail(() =>
      this.repository.getTrace(traceId),
    );
    if (!detail) throw new NotFoundError('Trace not found or expired');
    return detail;
  }

  async listMetrics(query: MetricQuery) {
    const times = range(query.from, query.to, 30 * DAY_MS);
    const statistic = (clean(query.statistic) ?? 'sum') as
      | 'count'
      | 'sum'
      | 'min'
      | 'max';
    if (!['count', 'sum', 'min', 'max'].includes(statistic)) {
      throw new ValidationError('Metric statistic is not supported');
    }
    const metric = clean(query.metric);
    if (
      metric &&
      !METRIC_NAMES.includes(metric as (typeof METRIC_NAMES)[number])
    ) {
      throw new ValidationError('Metric name is not supported');
    }
    const groups = metricGroups(clean(query.group));
    const parsedStep = Number.parseInt(query.step ?? '60', 10);
    if (!METRIC_STEPS.has(parsedStep)) {
      throw new ValidationError(
        'Metric step must be one of 60, 300, 900, or 3600 seconds',
      );
    }
    return this.readWithBlindSpot(
      () =>
        this.repository.listMetrics({
          ...times,
          step: query.step,
          statistic,
          stepSeconds: parsedStep,
          metric,
          service: clean(query.service),
          resourceKind: clean(query.resourceKind),
          resourceName: clean(query.resourceName),
          groups,
        }),
      {
        data: [],
        statistic,
        stepSeconds: parsedStep,
        coverage: {
          expectedBuckets: 0,
          storedBuckets: 0,
          missingBuckets: 0,
          storageStatus: 'blind_spot',
        },
        options: { metrics: [], services: [], resourceKinds: [] },
      },
    );
  }

  async listBenchmarkRuns(query: BenchmarkRunQuery) {
    if (query.cursor) {
      try {
        decodeBenchmarkCursor(query.cursor);
      } catch {
        throw new ValidationError('The benchmark cursor is invalid');
      }
    }
    return this.readWithBlindSpot(
      () =>
        this.repository.listBenchmarkRuns({
          ...query,
          scenarioId: clean(query.scenarioId),
          status: clean(query.status),
          sourceCommitSha: clean(query.sourceCommitSha),
          bunVersion: clean(query.bunVersion),
        }),
      {
        data: [],
        prevCursor: null,
        nextCursor: null,
        options: { scenarioIds: [], statuses: [], bunVersions: [] },
        storageStatus: 'blind_spot',
      },
    );
  }

  async getBenchmarkRun(runId: string) {
    this.requireStorage();
    const run = await this.readDetail(() =>
      this.repository.getBenchmarkRun(runId),
    );
    if (!run) throw new NotFoundError('Benchmark run not found or expired');
    return run;
  }

  async listBenchmarkBaselines(query: BenchmarkBaselineQuery) {
    if (query.cursor) {
      try {
        decodeBaselineCursor(query.cursor);
      } catch {
        throw new ValidationError('The benchmark baseline cursor is invalid');
      }
    }
    return this.readWithBlindSpot(
      () =>
        this.repository.listBenchmarkBaselines({
          scenarioId: clean(query.scenarioId),
          scenarioVersion: clean(query.scenarioVersion),
          fixtureVersion: clean(query.fixtureVersion),
          environment: clean(query.environment),
          cursor: query.cursor,
        }),
      {
        data: [],
        prevCursor: null,
        nextCursor: null,
        options: {
          scenarioIds: [],
          environments: [],
          fixtureVersions: [],
        },
        storageStatus: 'blind_spot',
      },
    );
  }

  async listAlerts(query: AlertQuery) {
    if (query.cursor) {
      try {
        decodeAlertCursor(query.cursor);
      } catch {
        throw new ValidationError('The alert cursor is invalid');
      }
    }
    return this.readWithBlindSpot(
      () =>
        this.repository.listAlerts({
          status: clean(query.status),
          severity: query.severity,
          service: clean(query.service),
          ruleId: clean(query.ruleId),
          seriesFingerprint: clean(query.seriesFingerprint),
          cursor: query.cursor,
        }),
      {
        data: [],
        prevCursor: null,
        nextCursor: null,
        options: { ruleIds: [], services: [] },
        storageStatus: 'blind_spot',
      },
    );
  }

  async getAlertsForRule(ruleId: string, seriesFingerprint?: string) {
    this.requireStorage();
    const result = await this.readDetail(() =>
      this.repository.listAlertsForRule(ruleId, clean(seriesFingerprint)),
    );
    if (result.data.length === 0)
      throw new NotFoundError('Alert rule not found');
    return result;
  }

  private requireStorage(): void {
    if (!this.repository.isStorageAvailable()) {
      throw new ServiceUnavailableError(
        'Telemetry storage is unavailable; observability is a blind spot',
        STORAGE_BLIND_SPOT,
      );
    }
  }

  private async readWithBlindSpot<T>(
    operation: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      return fallback;
    }
  }

  private async readDetail<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw this.storageUnavailable();
    }
  }

  private storageUnavailable(): ServiceUnavailableError {
    return new ServiceUnavailableError(
      'Telemetry storage is unavailable; observability is a blind spot',
      STORAGE_BLIND_SPOT,
    );
  }
}
