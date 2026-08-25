import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import {
  type BenchmarkBaseline,
  type BenchmarkReport,
  canonicalJson,
  overheadWithinPolicy,
  reportChecksum,
} from '#project/telemetry';

function argument(name: string): string | undefined {
  const index = Bun.argv.indexOf(`--${name}`);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

const calibrationPath = argument('calibration');
if (!calibrationPath) {
  throw new Error('baseline promotion requires --calibration artifact');
}

const calibration = (await Bun.file(calibrationPath).json()) as {
  valid?: boolean;
  medoid?: BenchmarkReport | null;
};
const medoid = calibration.medoid;
if (!calibration.valid || !medoid) {
  throw new Error('baseline promotion requires a valid calibration medoid');
}
if (
  medoid.status !== 'completed' ||
  !medoid.telemetryComplete ||
  !overheadWithinPolicy(medoid) ||
  medoid.validity.incompleteReasons.length > 0
) {
  throw new Error('calibration medoid is not eligible for promotion');
}
if (
  medoid.runner.environment === 'staging' &&
  (!medoid.runner.runnerProfile.stagingClass ||
    !medoid.runner.runnerProfile.stagingTargetUrl ||
    !medoid.runner.runnerProfile.stagingOwnership ||
    !medoid.runner.runnerProfile.stagingCleanupStateFile)
) {
  throw new Error(
    'staging calibration medoid must record target, class, ownership, and cleanup state',
  );
}
const { reportChecksum: receivedChecksum, ...withoutChecksum } = medoid;
if (reportChecksum(withoutChecksum) !== receivedChecksum) {
  throw new Error('calibration medoid has an invalid report checksum');
}

const baseline: BenchmarkBaseline = {
  baselineId: uuidv7(),
  scenario: medoid.scenario,
  approvedRunId: medoid.runId,
  fixtureVersion: medoid.scenario.fixtureVersion,
  environment: medoid.runner.environment,
  runnerProfile: medoid.runner.runnerProfile,
  instrumentationSchemaVersion: medoid.scenario.instrumentationSchemaVersion,
  thresholdPolicyVersion: medoid.scenario.thresholdPolicyVersion,
  approvalCommitSha: medoid.runner.commitSha,
  metricSnapshot: medoid.metrics,
  driverSnapshot: medoid.driver.instrumentationOn,
  promotedAt: new Date().toISOString(),
  active: true,
};
const outputPath = argument('output');
if (outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  await Bun.write(outputPath, `${canonicalJson(baseline)}\n`);
}
console.log(canonicalJson(baseline));
