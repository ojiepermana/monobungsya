import { createHash } from 'node:crypto';

export const BENCHMARK_SCHEMA_VERSION = '0014.1' as const;

export type BenchmarkKind = 'journey' | 'microbenchmark' | 'throughput';
export type BenchmarkOverheadPolicy = 'required' | 'diagnostic';
export type BenchmarkComparisonStatus =
  | 'pass'
  | 'fail'
  | 'calibrating'
  | 'not_comparable';
export type BenchmarkDecision = 'pass' | 'fail' | 'not_comparable';

export interface BenchmarkScenarioIdentity {
  scenarioId: string;
  scenarioVersion: string;
  kind: BenchmarkKind;
  overheadPolicy: BenchmarkOverheadPolicy;
  fixtureVersion: string;
  instrumentationSchemaVersion: string;
  thresholdPolicyVersion: string;
  manifestChecksum: string;
}

export interface BenchmarkRunnerProfile {
  os: string;
  arch: string;
  cpuModel: string;
  coreCount: number;
  memoryBytes: number;
  bunVersion: string;
  networkClass: string;
  successSampleRate: number;
  instrumentationMode?: 'production-sampling' | 'trace-capture';
  stagingClass?: string;
  stagingTargetUrl?: string;
  stagingOwnership?: string;
  stagingCleanupStateFile?: string;
}

export interface BenchmarkMetricSnapshot {
  resourceKind: string;
  resourceName: string;
  unit: string;
  operationCount: number;
  sampleCount?: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  min: number;
  max: number;
  errorCount: number;
  maximum?: number;
  coefficientOfVariation?: number;
}

export interface BenchmarkDriverSnapshot {
  cpuMs: number;
  cpuUtilizationPercent: number;
  rssBytes: number;
  heapUsedBytes: number;
  eventLoopLagP95Ms: number;
  throughputPerSecond: number;
  errorCount: number;
  operationCount: number;
  elapsedMs: number;
}

export interface BenchmarkValidity {
  observationCount: number;
  minimumObservations: number;
  coefficientOfVariation: number | null;
  driverCpuUtilizationPercent: number;
  driverEventLoopLagP95Ms: number;
  throughputByConcurrency: Record<string, number>;
  incompleteReasons: string[];
}

export interface BenchmarkOverhead {
  policy: BenchmarkOverheadPolicy;
  latencyP95Percent: number | null;
  cpuPercent: number | null;
  rssPercent: number | null;
  latencyLimitPercent: number;
  cpuLimitPercent: number;
  rssLimitPercent: number;
  withinLimits: boolean | null;
}

export interface BenchmarkComparison {
  resourceKind: string;
  resourceName: string;
  metricKey: string;
  statistic: MetricStatistic | DriverStatistic;
  unit: string;
  baselineValue: number | null;
  candidateValue: number;
  absoluteDelta: number | null;
  relativeDeltaPercent: number | null;
  absoluteThreshold: number | null;
  relativeThreshold: number | null;
  decision: BenchmarkDecision;
  evidenceUri: string | null;
}

type MetricStatistic =
  | 'p50'
  | 'p95'
  | 'p99'
  | 'mean'
  | 'max'
  | 'errorCount'
  | 'operationCount';

type DriverStatistic =
  | 'cpuMs'
  | 'rssBytes'
  | 'heapUsedBytes'
  | 'eventLoopLagP95Ms'
  | 'throughputPerSecond';

export interface BenchmarkReport {
  schemaVersion: typeof BENCHMARK_SCHEMA_VERSION;
  runId: string;
  scenario: BenchmarkScenarioIdentity;
  runner: {
    bunVersion: string;
    commitSha: string;
    branch: string | null;
    environment: string;
    runnerProfile: BenchmarkRunnerProfile;
  };
  source: {
    scenarioPath: string;
    scenarioChecksum: string;
    sourceChecksum: string;
  };
  startedAt: string;
  finishedAt: string;
  status: 'completed' | 'failed' | 'incomplete';
  telemetryComplete: boolean;
  droppedTelemetryCount: number;
  latencyOverheadPercent: number | null;
  cpuOverheadPercent: number | null;
  rssOverheadPercent: number | null;
  metrics: Record<string, BenchmarkMetricSnapshot>;
  driver: {
    instrumentationOn: BenchmarkDriverSnapshot;
    instrumentationOff: BenchmarkDriverSnapshot;
  };
  validity: BenchmarkValidity;
  overhead: BenchmarkOverhead;
  comparisons: BenchmarkComparison[];
  comparisonStatus: BenchmarkComparisonStatus;
  artifactUri: string | null;
  traceUri: string | null;
  failureReason: string | null;
  reportChecksum: string;
}

export interface BenchmarkBaseline {
  baselineId: string;
  scenario: BenchmarkScenarioIdentity;
  approvedRunId: string;
  fixtureVersion: string;
  environment: string;
  runnerProfile: BenchmarkRunnerProfile;
  instrumentationSchemaVersion: string;
  thresholdPolicyVersion: string;
  approvalCommitSha: string;
  metricSnapshot: Record<string, BenchmarkMetricSnapshot>;
  driverSnapshot?: BenchmarkDriverSnapshot;
  promotedAt: string;
  active: boolean;
  supersedesBaselineId?: string | null;
}

export interface CalibrationResult {
  valid: boolean;
  reason: string | null;
  medoid: BenchmarkReport | null;
}

type ChecksumDocument = Omit<BenchmarkReport, 'reportChecksum'>;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function reportChecksum(report: ChecksumDocument): string {
  return sha256(canonicalJson(report));
}

export function compatibilityKey(value: {
  scenario: Pick<
    BenchmarkScenarioIdentity,
    | 'scenarioId'
    | 'scenarioVersion'
    | 'kind'
    | 'overheadPolicy'
    | 'fixtureVersion'
    | 'instrumentationSchemaVersion'
    | 'manifestChecksum'
  >;
  runner: Pick<BenchmarkReport['runner'], 'environment' | 'runnerProfile'>;
}): string {
  const {
    bunVersion: _bunVersion,
    stagingClass: _stagingClass,
    stagingTargetUrl: _stagingTargetUrl,
    stagingOwnership: _stagingOwnership,
    stagingCleanupStateFile: _stagingCleanupStateFile,
    ...stableRunnerProfile
  } = value.runner.runnerProfile;
  return canonicalJson({
    scenarioId: value.scenario.scenarioId,
    scenarioVersion: value.scenario.scenarioVersion,
    kind: value.scenario.kind,
    overheadPolicy: value.scenario.overheadPolicy,
    fixtureVersion: value.scenario.fixtureVersion,
    manifestChecksum: value.scenario.manifestChecksum,
    environment: value.runner.environment,
    runnerProfile: stableRunnerProfile,
    instrumentationSchemaVersion: value.scenario.instrumentationSchemaVersion,
  });
}

export function overheadWithinPolicy(
  value: Pick<BenchmarkReport, 'overhead'>,
): boolean {
  return (
    value.overhead.policy === 'diagnostic' ||
    value.overhead.withinLimits === true
  );
}

function relativeDelta(baseline: number, candidate: number): number {
  if (baseline === 0) return candidate === 0 ? 0 : Number.POSITIVE_INFINITY;
  return ((candidate - baseline) / Math.abs(baseline)) * 100;
}

function decisionFor(
  metricName: string,
  statistic: MetricStatistic,
  baseline: BenchmarkMetricSnapshot,
  candidate: BenchmarkMetricSnapshot,
): {
  absoluteThreshold: number | null;
  relativeThreshold: number | null;
  failed: boolean;
} {
  const baselineValue = baseline[statistic];
  const candidateValue = candidate[statistic];
  const delta = candidateValue - baselineValue;
  const relative = relativeDelta(baselineValue, candidateValue);
  const lowerIsBetter =
    !metricName.includes('throughput') &&
    !metricName.includes('operationCount');

  if (statistic === 'operationCount' && candidate.maximum !== undefined) {
    return {
      absoluteThreshold: candidate.maximum,
      relativeThreshold: null,
      failed: candidateValue > candidate.maximum,
    };
  }

  if (statistic === 'errorCount') {
    return {
      absoluteThreshold: baselineValue === 0 ? 0 : null,
      relativeThreshold: 10,
      failed:
        baselineValue === 0
          ? candidateValue > 0
          : candidateValue > baselineValue && relative > 10,
    };
  }

  if (metricName.includes('throughput')) {
    return {
      absoluteThreshold: null,
      relativeThreshold: -10,
      failed: relative < -10,
    };
  }

  if (statistic !== 'p95') {
    return {
      absoluteThreshold: null,
      relativeThreshold: null,
      failed: false,
    };
  }

  const instrumentation = metricName.includes('instrumentation');
  const relativeThreshold = instrumentation ? 5 : 10;
  const absoluteThreshold = 5;
  return {
    absoluteThreshold,
    relativeThreshold,
    failed:
      lowerIsBetter &&
      relative > relativeThreshold &&
      delta > absoluteThreshold,
  };
}

function driverComparison(
  metricKey: string,
  candidate: number,
  baseline: number,
): {
  absoluteThreshold: number | null;
  relativeThreshold: number | null;
  failed: boolean;
} {
  if (metricKey === 'eventLoopLagP95Ms') {
    return {
      absoluteThreshold: null,
      relativeThreshold: null,
      failed: false,
    };
  }
  const relative = relativeDelta(baseline, candidate);
  if (metricKey === 'throughputPerSecond') {
    return {
      absoluteThreshold: null,
      relativeThreshold: -10,
      failed: relative < -10,
    };
  }
  if (metricKey === 'errorCount') {
    return {
      absoluteThreshold: baseline === 0 ? 0 : null,
      relativeThreshold: 10,
      failed:
        baseline === 0 ? candidate > 0 : candidate > baseline && relative > 10,
    };
  }
  if (metricKey === 'operationCount') {
    return {
      absoluteThreshold: baseline,
      relativeThreshold: null,
      failed: candidate > baseline,
    };
  }
  return {
    absoluteThreshold: null,
    relativeThreshold: 10,
    failed: relative > 10,
  };
}

export function compareBenchmark(
  candidate: Pick<
    BenchmarkReport,
    'scenario' | 'runner' | 'metrics' | 'driver'
  >,
  baseline: Pick<
    BenchmarkBaseline,
    | 'scenario'
    | 'runnerProfile'
    | 'environment'
    | 'metricSnapshot'
    | 'driverSnapshot'
  >,
): { status: BenchmarkComparisonStatus; comparisons: BenchmarkComparison[] } {
  const baselineIdentity = {
    scenario: baseline.scenario,
    runner: {
      environment: baseline.environment,
      runnerProfile: baseline.runnerProfile,
    },
  };
  if (compatibilityKey(candidate) !== compatibilityKey(baselineIdentity)) {
    return {
      status: 'not_comparable',
      comparisons: Object.entries(candidate.metrics).map(
        ([metricName, metric]) => ({
          resourceKind: metric.resourceKind,
          resourceName: metric.resourceName,
          metricKey: metricName,
          statistic: 'p95',
          unit: metric.unit,
          baselineValue: null,
          candidateValue: metric.p95,
          absoluteDelta: null,
          relativeDeltaPercent: null,
          absoluteThreshold: null,
          relativeThreshold: null,
          decision: 'not_comparable',
          evidenceUri: null,
        }),
      ),
    };
  }

  const comparisons: BenchmarkComparison[] = [];
  for (const [metricName, candidateMetric] of Object.entries(
    candidate.metrics,
  )) {
    const baselineMetric = baseline.metricSnapshot[metricName];
    if (!baselineMetric) {
      comparisons.push({
        resourceKind: candidateMetric.resourceKind,
        resourceName: candidateMetric.resourceName,
        metricKey: metricName,
        statistic: 'p95',
        unit: candidateMetric.unit,
        baselineValue: null,
        candidateValue: candidateMetric.p95,
        absoluteDelta: null,
        relativeDeltaPercent: null,
        absoluteThreshold: null,
        relativeThreshold: null,
        decision: 'not_comparable',
        evidenceUri: null,
      });
      continue;
    }

    const statistics: MetricStatistic[] = [
      'p50',
      'p95',
      'p99',
      'mean',
      'max',
      'errorCount',
      'operationCount',
    ];
    for (const statistic of statistics) {
      const baselineValue = baselineMetric[statistic];
      const candidateValue = candidateMetric[statistic];
      const policy = decisionFor(
        metricName,
        statistic,
        baselineMetric,
        candidateMetric,
      );
      const absoluteDelta = candidateValue - baselineValue;
      comparisons.push({
        resourceKind: candidateMetric.resourceKind,
        resourceName: candidateMetric.resourceName,
        metricKey: metricName,
        statistic,
        unit: candidateMetric.unit,
        baselineValue,
        candidateValue,
        absoluteDelta,
        relativeDeltaPercent: relativeDelta(baselineValue, candidateValue),
        absoluteThreshold: policy.absoluteThreshold,
        relativeThreshold: policy.relativeThreshold,
        decision: policy.failed ? 'fail' : 'pass',
        evidenceUri: null,
      });
    }
  }

  if (candidate.driver && baseline.driverSnapshot) {
    const driverValues: Array<{
      key: BenchmarkComparison['statistic'];
      unit: string;
      candidate: number;
      baseline: number;
    }> = [
      {
        key: 'cpuMs',
        unit: 'ms',
        candidate: candidate.driver.instrumentationOn.cpuMs,
        baseline: baseline.driverSnapshot.cpuMs,
      },
      {
        key: 'rssBytes',
        unit: 'bytes',
        candidate: candidate.driver.instrumentationOn.rssBytes,
        baseline: baseline.driverSnapshot.rssBytes,
      },
      {
        key: 'heapUsedBytes',
        unit: 'bytes',
        candidate: candidate.driver.instrumentationOn.heapUsedBytes,
        baseline: baseline.driverSnapshot.heapUsedBytes,
      },
      {
        key: 'eventLoopLagP95Ms',
        unit: 'ms',
        candidate: candidate.driver.instrumentationOn.eventLoopLagP95Ms,
        baseline: baseline.driverSnapshot.eventLoopLagP95Ms,
      },
      {
        key: 'throughputPerSecond',
        unit: 'operations/s',
        candidate: candidate.driver.instrumentationOn.throughputPerSecond,
        baseline: baseline.driverSnapshot.throughputPerSecond,
      },
      {
        key: 'errorCount',
        unit: 'count',
        candidate: candidate.driver.instrumentationOn.errorCount,
        baseline: baseline.driverSnapshot.errorCount,
      },
      {
        key: 'operationCount',
        unit: 'count',
        candidate: candidate.driver.instrumentationOn.operationCount,
        baseline: baseline.driverSnapshot.operationCount,
      },
    ];
    for (const value of driverValues) {
      const policy = driverComparison(
        value.key,
        value.candidate,
        value.baseline,
      );
      comparisons.push({
        resourceKind: 'business.operation',
        resourceName: 'benchmark.driver',
        metricKey: `driver.${value.key}`,
        statistic: value.key,
        unit: value.unit,
        baselineValue: value.baseline,
        candidateValue: value.candidate,
        absoluteDelta: value.candidate - value.baseline,
        relativeDeltaPercent: relativeDelta(value.baseline, value.candidate),
        absoluteThreshold: policy.absoluteThreshold,
        relativeThreshold: policy.relativeThreshold,
        decision: policy.failed ? 'fail' : 'pass',
        evidenceUri: null,
      });
    }
  }

  return {
    status: comparisons.some((comparison) => comparison.decision === 'fail')
      ? 'fail'
      : 'pass',
    comparisons,
  };
}

/** Selects the real run closest to the median metric vector for promotion. */
export function selectCalibrationMedoid(
  reports: readonly BenchmarkReport[],
): CalibrationResult {
  if (reports.length < 20) {
    return {
      valid: false,
      reason: 'calibration requires at least 20 runs',
      medoid: null,
    };
  }
  const first = reports[0];
  if (!first) {
    return { valid: false, reason: 'calibration has no reports', medoid: null };
  }
  if (
    reports.some(
      (report) =>
        report.status !== 'completed' ||
        !report.telemetryComplete ||
        !overheadWithinPolicy(report) ||
        report.validity.incompleteReasons.length > 0,
    )
  ) {
    return {
      valid: false,
      reason: 'calibration contains incomplete or over-limit runs',
      medoid: null,
    };
  }
  const runIds = new Set(reports.map((report) => report.runId));
  if (runIds.size !== reports.length) {
    return {
      valid: false,
      reason: 'calibration contains duplicate run IDs',
      medoid: null,
    };
  }
  if (
    reports.some((report) => {
      const { reportChecksum: receivedChecksum, ...withoutChecksum } = report;
      return reportChecksum(withoutChecksum) !== receivedChecksum;
    })
  ) {
    return {
      valid: false,
      reason: 'calibration contains an invalid report checksum',
      medoid: null,
    };
  }
  const key = compatibilityKey(first);
  if (reports.some((report) => compatibilityKey(report) !== key)) {
    return {
      valid: false,
      reason: 'calibration runs do not share a compatibility key',
      medoid: null,
    };
  }
  const metricNames = Object.keys(first.metrics);
  if (
    metricNames.length === 0 ||
    reports.some((report) => metricNames.some((name) => !report.metrics[name]))
  ) {
    return {
      valid: false,
      reason: 'calibration metrics are incomplete',
      medoid: null,
    };
  }

  const interquartileFences = new Map<
    string,
    { lower: number; upper: number }
  >();
  for (const name of metricNames) {
    const values = reports.map((report) => report.metrics[name]?.p95 ?? 0);
    const sorted = [...values].sort((left, right) => left - right);
    const lower = sorted[Math.floor((sorted.length - 1) * 0.25)] ?? 0;
    const upper = sorted[Math.floor((sorted.length - 1) * 0.75)] ?? 0;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance =
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      Math.max(1, values.length - 1);
    const coefficient = mean === 0 ? 0 : Math.sqrt(variance) / Math.abs(mean);
    if (coefficient > 0.1) {
      return {
        valid: false,
        reason: `metric ${name} is noisy (coefficient of variation > 10%)`,
        medoid: null,
      };
    }
    const interquartileRange = upper - lower;
    interquartileFences.set(name, {
      lower: lower - 1.5 * interquartileRange,
      upper: upper + 1.5 * interquartileRange,
    });
  }

  // A strict coordinatewise IQR intersection can be empty for a valid
  // multivariate run set. Keep the robust Tukey fence per metric instead.
  const inlierReports = reports.filter((report) =>
    metricNames.every((name) => {
      const value = report.metrics[name]?.p95;
      const fence = interquartileFences.get(name);
      return (
        value !== undefined &&
        fence !== undefined &&
        value >= fence.lower &&
        value <= fence.upper
      );
    }),
  );
  if (inlierReports.length < 20) {
    return {
      valid: false,
      reason: 'calibration has fewer than 20 robust inlier runs',
      medoid: null,
    };
  }

  const inlierMedians = new Map<string, number>();
  for (const name of metricNames) {
    const values = inlierReports
      .map((report) => report.metrics[name]?.p95 ?? 0)
      .sort((left, right) => left - right);
    inlierMedians.set(name, values[Math.floor(values.length / 2)] ?? 0);
  }

  const driverStatistics: Array<keyof BenchmarkDriverSnapshot> = [
    'cpuMs',
    'rssBytes',
    'heapUsedBytes',
    'eventLoopLagP95Ms',
    'throughputPerSecond',
  ];
  const driverMedians = new Map<keyof BenchmarkDriverSnapshot, number>();
  for (const statistic of driverStatistics) {
    const values = inlierReports
      .map((report) => report.driver.instrumentationOn[statistic])
      .sort((left, right) => left - right);
    driverMedians.set(statistic, values[Math.floor(values.length / 2)] ?? 0);
  }

  const medoidScore = (report: BenchmarkReport): number =>
    metricNames.reduce((sum, name) => {
      const value = report.metrics[name]?.p95 ?? 0;
      const target = inlierMedians.get(name) ?? 0;
      return sum + Math.abs(value - target) / Math.max(Math.abs(target), 1e-9);
    }, 0) +
    driverStatistics.reduce((sum, statistic) => {
      const value = report.driver.instrumentationOn[statistic];
      const target = driverMedians.get(statistic) ?? 0;
      return sum + Math.abs(value - target) / Math.max(Math.abs(target), 1e-9);
    }, 0);

  const medoid = inlierReports.reduce((best, report) => {
    const score = medoidScore(report);
    const bestScore = medoidScore(best);
    return score < bestScore ? report : best;
  });
  return { valid: true, reason: null, medoid };
}
