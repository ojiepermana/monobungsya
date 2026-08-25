import { describe, expect, test } from 'bun:test';
import {
  type BenchmarkBaseline,
  type BenchmarkReport,
  compareBenchmark,
  reportChecksum,
  selectCalibrationMedoid,
} from './benchmark';

const profile = {
  os: 'linux',
  arch: 'x64',
  cpuModel: 'test',
  coreCount: 4,
  memoryBytes: 1024,
  bunVersion: '1.4.0',
  networkClass: 'isolated',
  successSampleRate: 0.05,
};

const scenario = {
  scenarioId: 'scenario',
  scenarioVersion: '1',
  kind: 'microbenchmark' as const,
  overheadPolicy: 'required' as const,
  fixtureVersion: '1',
  instrumentationSchemaVersion: '0014.1',
  thresholdPolicyVersion: '0014.default',
  manifestChecksum: 'a'.repeat(64),
};

const metric = {
  resourceKind: 'business.operation',
  resourceName: 'benchmark.operation',
  unit: 'ms',
  operationCount: 100,
  p50: 1,
  p95: 10,
  p99: 12,
  mean: 4,
  min: 1,
  max: 20,
  errorCount: 0,
};

function withChecksum(
  value: Omit<BenchmarkReport, 'reportChecksum'>,
): BenchmarkReport {
  return { ...value, reportChecksum: reportChecksum(value) };
}

function report(): BenchmarkReport {
  return withChecksum({
    schemaVersion: '0014.1',
    runId: 'run',
    scenario,
    runner: {
      bunVersion: '1.4.0',
      commitSha: 'candidate',
      branch: 'main',
      environment: 'staging',
      runnerProfile: profile,
    },
    source: {
      scenarioPath: 'scenario.json',
      scenarioChecksum: scenario.manifestChecksum,
      sourceChecksum: scenario.manifestChecksum,
    },
    startedAt: '2026-08-25T00:00:00.000Z',
    finishedAt: '2026-08-25T00:00:01.000Z',
    status: 'completed',
    telemetryComplete: true,
    droppedTelemetryCount: 0,
    latencyOverheadPercent: null,
    cpuOverheadPercent: null,
    rssOverheadPercent: null,
    metrics: { operation: metric },
    driver: {
      instrumentationOn: {
        cpuMs: 1,
        cpuUtilizationPercent: 1,
        rssBytes: 1,
        heapUsedBytes: 1,
        eventLoopLagP95Ms: 1,
        throughputPerSecond: 1,
        errorCount: 0,
        operationCount: 100,
        elapsedMs: 100,
      },
      instrumentationOff: {
        cpuMs: 1,
        cpuUtilizationPercent: 1,
        rssBytes: 1,
        heapUsedBytes: 1,
        eventLoopLagP95Ms: 1,
        throughputPerSecond: 1,
        errorCount: 0,
        operationCount: 100,
        elapsedMs: 100,
      },
    },
    validity: {
      observationCount: 100,
      minimumObservations: 100,
      coefficientOfVariation: 0,
      driverCpuUtilizationPercent: 1,
      driverEventLoopLagP95Ms: 1,
      throughputByConcurrency: {},
      incompleteReasons: [],
    },
    overhead: {
      policy: 'required',
      latencyP95Percent: 0,
      cpuPercent: 0,
      rssPercent: 0,
      latencyLimitPercent: 5,
      cpuLimitPercent: 5,
      rssLimitPercent: 10,
      withinLimits: true,
    },
    comparisons: [],
    comparisonStatus: 'not_comparable',
    artifactUri: null,
    traceUri: null,
    failureReason: null,
  });
}

function baseline(): BenchmarkBaseline {
  return {
    baselineId: 'baseline',
    scenario,
    approvedRunId: 'run',
    fixtureVersion: '1',
    environment: 'staging',
    runnerProfile: profile,
    instrumentationSchemaVersion: '0014.1',
    thresholdPolicyVersion: '0014.default',
    approvalCommitSha: 'baseline',
    metricSnapshot: { operation: metric },
    promotedAt: '2026-08-25T00:00:00.000Z',
    active: true,
  };
}

describe('benchmark comparison', () => {
  test('keeps the same compatibility key comparable across commits', () => {
    const result = compareBenchmark(report(), baseline());
    expect(result.status).toBe('pass');
    expect(result.comparisons).toHaveLength(7);
    expect(result.comparisons.every((item) => item.decision === 'pass')).toBe(
      true,
    );
  });

  test('keeps Bun upgrades comparable while showing the runner evidence', () => {
    const candidate = report();
    candidate.runner.bunVersion = '1.5.0';
    candidate.runner.runnerProfile = { ...profile, bunVersion: '1.5.0' };
    const result = compareBenchmark(candidate, baseline());
    expect(result.status).toBe('pass');
  });

  test('does not compare different runner profiles', () => {
    const candidate = report();
    candidate.runner.runnerProfile = { ...profile, coreCount: 8 };
    const result = compareBenchmark(candidate, baseline());
    expect(result.status).toBe('not_comparable');
    expect(result.comparisons[0]?.decision).toBe('not_comparable');
  });

  test('does not compare a changed scenario manifest', () => {
    const candidate = report();
    candidate.scenario = {
      ...candidate.scenario,
      manifestChecksum: 'b'.repeat(64),
    };
    const result = compareBenchmark(candidate, baseline());
    expect(result.status).toBe('not_comparable');
    expect(result.comparisons[0]?.decision).toBe('not_comparable');
  });

  test('does not compare different success sampling rates', () => {
    const candidate = report();
    candidate.runner.runnerProfile = { ...profile, successSampleRate: 0 };
    const result = compareBenchmark(candidate, baseline());
    expect(result.status).toBe('not_comparable');
    expect(result.comparisons[0]?.decision).toBe('not_comparable');
  });

  test('applies both relative and absolute latency gates', () => {
    const candidate = report();
    candidate.metrics.operation = { ...metric, p95: 16 };
    const result = compareBenchmark(candidate, baseline());
    expect(result.status).toBe('fail');
    expect(
      result.comparisons.find((item) => item.statistic === 'p95')?.decision,
    ).toBe('fail');
  });

  test('compares driver CPU, RSS, throughput, and error evidence when baselined', () => {
    const candidate = report();
    candidate.driver.instrumentationOn = {
      ...candidate.driver.instrumentationOn,
      cpuMs: 2,
      rssBytes: 2,
      throughputPerSecond: 0.8,
    };
    const result = compareBenchmark(candidate, {
      ...baseline(),
      driverSnapshot: report().driver.instrumentationOn,
    });
    expect(result.status).toBe('fail');
    expect(
      result.comparisons.find((item) => item.metricKey === 'driver.cpuMs')
        ?.decision,
    ).toBe('fail');
    expect(
      result.comparisons.find(
        (item) => item.metricKey === 'driver.throughputPerSecond',
      )?.decision,
    ).toBe('fail');
  });

  test('reports event-loop lag without turning relative noise into a regression', () => {
    const candidate = report();
    candidate.driver.instrumentationOn.eventLoopLagP95Ms = 100;
    const result = compareBenchmark(candidate, {
      ...baseline(),
      driverSnapshot: report().driver.instrumentationOn,
    });
    const comparison = result.comparisons.find(
      (item) => item.metricKey === 'driver.eventLoopLagP95Ms',
    );
    expect(result.status).toBe('pass');
    expect(comparison?.decision).toBe('pass');
    expect(comparison?.relativeThreshold).toBeNull();
  });
});

function calibrationReport(index: number): BenchmarkReport {
  const calibrationMetric = {
    ...metric,
    p50: 1 + index / 10_000,
    p95: 2 + index / 10_000,
    p99: 3 + index / 10_000,
    mean: 1.5 + index / 10_000,
  };
  const candidate = {
    ...report(),
    runId: `0198f8a0-0000-7000-8000-${String(index).padStart(12, '0')}`,
    metrics: { operation: calibrationMetric },
  };
  const { reportChecksum: _receivedChecksum, ...withoutChecksum } = candidate;
  return withChecksum(withoutChecksum);
}

describe('benchmark calibration', () => {
  test('requires 20 valid runs and chooses a medoid', () => {
    const result = selectCalibrationMedoid(
      Array.from({ length: 20 }, (_, index) => calibrationReport(index)),
    );
    expect(result.valid).toBe(true);
    expect(result.medoid?.runId).toBe(calibrationReport(10).runId);
  });

  test('rejects noisy calibration runs', () => {
    const reports = Array.from({ length: 20 }, (_, index) => {
      const candidate = calibrationReport(index);
      if (index === 19) {
        const operation = candidate.metrics.operation;
        if (operation) operation.p95 = 200;
      }
      const { reportChecksum: _receivedChecksum, ...withoutChecksum } =
        candidate;
      return withChecksum(withoutChecksum);
    });
    const result = selectCalibrationMedoid(reports);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('noisy');
  });

  test('keeps 20 robust runs when one bounded outlier is present', () => {
    const reports = Array.from({ length: 21 }, (_, index) => {
      const candidate = calibrationReport(index);
      if (index === 20) {
        const operation = candidate.metrics.operation;
        if (operation) operation.p95 = 2.1;
      }
      const { reportChecksum: _receivedChecksum, ...withoutChecksum } =
        candidate;
      return withChecksum(withoutChecksum);
    });

    const result = selectCalibrationMedoid(reports);

    expect(result.valid).toBe(true);
    expect(result.medoid?.runId).not.toBe(calibrationReport(20).runId);
  });
});
