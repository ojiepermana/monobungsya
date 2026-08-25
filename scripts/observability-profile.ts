import { chmod, mkdir, open, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { closeDatabaseClient, createDatabaseClient } from '#project/database';
import { ActivityLog, Logger } from '#project/logger';
import { sha256, TelemetryRuntime } from '#project/telemetry';

function argument(name: string): string | undefined {
  const index = Bun.argv.indexOf(`--${name}`);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

const service = argument('service');
const pidValue = argument('pid');
const durationValue = argument('duration');
const pid = Number.parseInt(pidValue ?? '', 10);
const duration = Number.parseInt(durationValue ?? '', 10);
const maxDuration = Number.parseInt(
  Bun.env.OBSERVABILITY_PROFILE_MAX_SECONDS ?? '60',
  10,
);
const telemetry = new TelemetryRuntime({
  serviceName: 'observability-profile',
  serviceInstanceId: `observability-profile-${process.pid}`,
  enabled: true,
});
const logDatabase = Bun.env.LOG_DATABASE_URL?.trim()
  ? createDatabaseClient(Bun.env.LOG_DATABASE_URL)
  : undefined;
ActivityLog.configure(logDatabase, { bestEffort: Boolean(logDatabase) });
const logger = new Logger('observability-profile', 'info', {
  persist: Boolean(logDatabase),
});

const profileDirectory =
  Bun.env.OBSERVABILITY_PROFILE_DIR ??
  '/tmp/monobungsia-observability-profiles';
const safeService = service?.replace(/[^A-Za-z0-9._-]/g, '_') ?? 'unknown';
const lockPath = join(profileDirectory, `${safeService}.lock`);

function artifactPath(extension: 'cpuprofile' | 'md'): string {
  return join(
    profileDirectory,
    `${safeService}-${Date.now()}-${process.pid}.${extension}`,
  );
}

async function runDarwinAttachProfile(path: string): Promise<number> {
  const child = Bun.spawn(
    [
      '/usr/bin/sample',
      String(pid),
      String(duration),
      '1',
      '-mayDie',
      '-file',
      path,
    ],
    { stdout: 'ignore', stderr: 'pipe' },
  );
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(child.stderr).text().catch(() => '');
    throw new Error(
      `CPU profile sampler exited with ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
    );
  }
  return exitCode;
}

async function cleanupExpiredArtifacts(): Promise<void> {
  await mkdir(profileDirectory, { recursive: true });
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const name of await readdir(profileDirectory)) {
    if (
      !name.startsWith(`${safeService}-`) ||
      (!name.endsWith('.cpuprofile') && !name.endsWith('.md'))
    ) {
      continue;
    }
    const path = join(profileDirectory, name);
    const details = await stat(path).catch(() => null);
    if (!details || details.mtimeMs >= cutoff) continue;
    await telemetry.withSpan(
      {
        resourceKind: 'fs.operation',
        resourceName: 'cpu-profile.artifact-lifecycle',
        operation: 'delete_expired',
      },
      () => unlink(path),
    );
  }
}

if (!service || !Number.isInteger(pid) || pid < 1) {
  throw new Error('--service and a positive --pid are required');
}
if (!Number.isInteger(duration) || duration < 1 || duration > maxDuration) {
  throw new Error(`--duration must be between 1 and ${maxDuration} seconds`);
}

logger.info('observability.profile.started', {
  service,
  durationSeconds: duration,
});

await cleanupExpiredArtifacts();
let lock: Awaited<ReturnType<typeof open>> | undefined;
let artifact: string | undefined;
try {
  lock = await open(lockPath, 'wx', 0o600);
  await lock.write(`${process.pid}\n`);
} catch (error) {
  if (lock) await lock.close();
  if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
    console.log(
      JSON.stringify({
        status: 'already_active',
        service,
        durationSeconds: duration,
      }),
    );
    process.exitCode = 1;
    await telemetry.shutdown(1_000);
    process.exit();
  }
  throw error;
}

try {
  telemetry.withSpan(
    {
      resourceKind: 'process.spawn',
      resourceName: 'cpu-profile.attach',
      operation: 'probe',
    },
    () => process.kill(pid, 0),
  );

  if (process.platform === 'darwin') {
    artifact = artifactPath('md');
    await telemetry.withSpan(
      {
        resourceKind: 'process.spawn',
        resourceName: 'cpu-profile.attach',
        operation: 'sample',
      },
      () => runDarwinAttachProfile(artifact as string),
    );
    await chmod(artifact, 0o600);
    const details = await stat(artifact);
    if (details.size < 1) throw new Error('CPU profile artifact is empty');
    const artifactChecksum = sha256(await Bun.file(artifact).text());
    const result = {
      status: 'completed' as const,
      service,
      pid,
      durationSeconds: duration,
      artifact,
      artifactBytes: details.size,
      artifactChecksum,
    };
    logger.info('observability.profile.completed', {
      service,
      durationSeconds: duration,
      artifactChecksum,
    });
    console.log(JSON.stringify(result));
  } else {
    const result = {
      status: 'unsupported_runtime' as const,
      service,
      pid,
      durationSeconds: duration,
      reason:
        'Bun CPU profiling is launch based on this runtime and the current operating system has no supported attach sampler',
    };
    logger.warn('observability.profile.unsupported_runtime', {
      service,
      durationSeconds: duration,
    });
    console.log(JSON.stringify(result));
    process.exitCode = 2;
  }
} catch (error) {
  await unlink(artifact ?? '').catch(() => undefined);
  logger.error('observability.profile.failed', {
    service,
    durationSeconds: duration,
    errorClass:
      error instanceof Error ? error.constructor.name : 'UnknownError',
  });
  throw new Error(
    `CPU profile could not be collected for target process ${pid}`,
  );
} finally {
  logger.info('observability.profile.stopped', {
    service,
    durationSeconds: duration,
  });
  await lock?.close();
  await unlink(lockPath).catch(() => undefined);
  await ActivityLog.flush(1_000);
  await telemetry.shutdown(1_000);
  if (logDatabase) await closeDatabaseClient(logDatabase);
}
