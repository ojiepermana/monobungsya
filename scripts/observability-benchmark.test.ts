import { afterAll, describe, expect, test } from 'bun:test';
import { unlink } from 'node:fs/promises';

const baselinePath = `/private/tmp/observability-benchmark-regression-baseline-${crypto.randomUUID()}.json`;
const candidatePath = `/private/tmp/observability-benchmark-regression-candidate-${crypto.randomUUID()}.json`;

async function runBenchmark(outputPath: string, baseline?: string) {
  const args = [
    'run',
    'scripts/observability-benchmark.ts',
    '--warmup',
    '1',
    '--iterations',
    '2',
    '--groups',
    '2',
    '--output',
    outputPath,
  ];
  if (baseline) args.push('--baseline', baseline);
  const child = Bun.spawn({
    cmd: ['bun', ...args],
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await child.exited;
  return child.exitCode;
}

afterAll(async () => {
  await Promise.all([
    unlink(baselinePath).catch(() => undefined),
    unlink(candidatePath).catch(() => undefined),
  ]);
});

describe('observability benchmark artifact', () => {
  test('recomputes the checksum after adding comparisons', async () => {
    await runBenchmark(baselinePath);
    await runBenchmark(candidatePath, baselinePath);

    const candidate = await Bun.file(candidatePath).json();
    const { reportChecksum: receivedChecksum, ...reportWithoutChecksum } =
      candidate;

    const { reportChecksum } = await import('#project/telemetry');
    expect(receivedChecksum).toBe(reportChecksum(reportWithoutChecksum));
  });

  test('emits runtime probes and marks low-observation runs incomplete', async () => {
    await runBenchmark(baselinePath);
    const report = await Bun.file(baselinePath).json();
    expect(report.driver.instrumentationOn.cpuMs).toBeGreaterThanOrEqual(0);
    expect(report.driver.instrumentationOn.rssBytes).toBeGreaterThan(0);
    expect(report.driver.instrumentationOn.heapUsedBytes).toBeGreaterThan(0);
    expect(
      report.driver.instrumentationOn.eventLoopLagP95Ms,
    ).toBeGreaterThanOrEqual(0);
    expect(report.driver.instrumentationOn.throughputPerSecond).toBeGreaterThan(
      0,
    );
    const expectedCpuOverhead =
      ((report.driver.instrumentationOn.cpuMs -
        report.driver.instrumentationOff.cpuMs) /
        Math.abs(report.driver.instrumentationOff.cpuMs)) *
      100;
    const expectedRssOverhead =
      ((report.driver.instrumentationOn.rssBytes -
        report.driver.instrumentationOff.rssBytes) /
        Math.abs(report.driver.instrumentationOff.rssBytes)) *
      100;
    expect(report.cpuOverheadPercent).toBe(expectedCpuOverhead);
    expect(report.rssOverheadPercent).toBe(expectedRssOverhead);
    expect(report.validity.observationCount).toBe(4);
    expect(report.validity.incompleteReasons).toContain(
      'fewer than 100 observations per metric',
    );
    expect(report.overhead.latencyLimitPercent).toBe(5);
    expect(report.overhead.policy).toBe('diagnostic');
    expect(report.overhead.rssLimitPercent).toBe(10);
  });
});
