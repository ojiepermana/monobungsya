import { closeDatabaseClient, createDatabaseClient } from '#project/database';
import {
  AUTH_JOB_CONTRACTS,
  DurableJobRuntime,
  DurableJobScheduler,
  DurableJobWorker,
  type JobContract,
  JobRegistry,
  observabilityAlertEvaluateContract,
  observabilityAlertNotificationContract,
} from '#project/jobs';
import { ActivityLog, Logger } from '#project/logger';
import {
  createRuntimeClickHouseProbeReader,
  createRuntimeClickHouseSignalReader,
  createRuntimeObservabilitySignalStore,
} from '#project/observability';
import { TelemetryRuntime } from '#project/telemetry';
import { createApp } from './app';
import { env } from './config/env';
import {
  CLICKHOUSE_AVAILABILITY_PROBE_INTERVAL_MS,
  ObservabilityAlertEvaluator,
} from './observability-evaluator';

const database = env.ENABLE_INFRASTRUCTURE
  ? createDatabaseClient(env.JOBS_DATABASE_URL)
  : undefined;
const logDatabase = env.ENABLE_INFRASTRUCTURE
  ? createDatabaseClient(env.LOG_DATABASE_URL)
  : undefined;
const telemetryDatabase =
  env.TELEMETRY_ENABLED && env.ENABLE_INFRASTRUCTURE
    ? createDatabaseClient(env.TELEMETRY_DATABASE_URL)
    : undefined;
const observabilityDatabase = env.ENABLE_INFRASTRUCTURE
  ? createDatabaseClient(env.OBSERVABILITY_DATABASE_URL)
  : undefined;
const signalStore = await createRuntimeObservabilitySignalStore({
  environment: env,
  logsDatabase: logDatabase,
  telemetryDatabase,
  controlDatabase: observabilityDatabase,
});
const usesClickHouseSignalStorage =
  env.OBSERVABILITY_SIGNAL_WRITE_MODE !== 'postgres';
const clickHouseProbeReader =
  database && usesClickHouseSignalStorage
    ? await createRuntimeClickHouseProbeReader(env)
    : { reader: null, readiness: null };
const clickHouseSignalReader = database
  ? await createRuntimeClickHouseSignalReader(env, {
      controlDatabase: observabilityDatabase,
    })
  : { reader: null, readiness: null };
const telemetry = env.TELEMETRY_ENABLED
  ? new TelemetryRuntime({
      serviceName: env.serviceName,
      serviceInstanceId: env.serviceInstanceId,
      signalStore,
      flushIntervalMs: env.TELEMETRY_FLUSH_INTERVAL_MS,
      slowThresholdMs: env.TELEMETRY_SLOW_THRESHOLD_MS,
      successSampleRate: env.TELEMETRY_SUCCESS_SAMPLE_RATE,
    })
  : undefined;
ActivityLog.configure(logDatabase, {
  bestEffort: env.BEST_EFFORT_LOGGING_ENABLED,
  signalStore,
});

const logger = new Logger(env.serviceName, env.LOG_LEVEL, {
  persist: env.BEST_EFFORT_LOGGING_ENABLED,
});
const registry = new JobRegistry();
for (const contract of AUTH_JOB_CONTRACTS) {
  registry.registerContract(contract as unknown as JobContract<never>);
}
registry.registerContract(observabilityAlertNotificationContract);

let ready = !database;
const scheduler = database
  ? new DurableJobScheduler(database, registry, {
      schedulerId: `jobs-${process.pid}`,
      catchUpLimit: env.JOB_SCHEDULE_CATCH_UP_LIMIT,
      leaseMs: Math.min(env.JOB_LEASE_MS, 30_000),
      telemetry,
      onEvent: (event) =>
        logger.info(`jobs.${event.name}`, {
          code: event.code,
          count: event.count,
          error: event.error instanceof Error ? event.error.message : undefined,
        }),
    })
  : undefined;
const runtime = database
  ? new DurableJobRuntime(database, registry, { telemetry })
  : undefined;
const alertEvaluator = database
  ? new ObservabilityAlertEvaluator(
      database,
      registry,
      env.OBSERVABILITY_ALERT_RULES_PATH,
      telemetry,
      {
        readMode: env.OBSERVABILITY_SIGNAL_READ_MODE,
        clickHouseReader: clickHouseSignalReader.reader,
        clickHouseProbeReader: clickHouseProbeReader.reader,
      },
    )
  : undefined;
if (database && runtime && alertEvaluator) {
  registry.registerContract(observabilityAlertEvaluateContract);
  registry.bind(observabilityAlertEvaluateContract, async () => {
    try {
      await alertEvaluator.evaluate();
    } catch (error) {
      telemetry?.addCounter('telemetry.errors.total', 1, {
        resource_kind: 'business.operation',
        resource_name: 'observability.alert.evaluate',
        status: 'error',
      });
      throw error;
    }
  });
}
const alertWorker =
  database && runtime
    ? new DurableJobWorker(runtime, registry, {
        workerId: `jobs-alert-${process.pid}`,
        targetService: 'jobs',
        telemetry,
      })
    : undefined;
alertWorker?.start();

async function scheduleTick(): Promise<void> {
  if (!scheduler || !runtime) return;
  try {
    await scheduler.runOnce();
    await runtime.recoverExpired();
  } catch (error) {
    logger.error('jobs.scheduler.failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function cleanupTick(): Promise<void> {
  if (!database) return;
  const before = new Date(
    Date.now() - env.JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const runWithTelemetry = async <T>(
    resourceName: string,
    operation: string,
    query: () => Promise<T>,
  ): Promise<T> => {
    if (telemetry) {
      return telemetry.withSpan(
        {
          resourceKind: 'db.query',
          resourceName,
          operation,
        },
        query,
      );
    }
    return query();
  };

  try {
    await runWithTelemetry(
      'jobs.retention.cleanup',
      'delete',
      () =>
        database`
          SELECT jobs.cleanup_terminal_jobs(${before}, 500)
        `,
    );
  } catch (error) {
    logger.error('jobs.retention.failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await runWithTelemetry(
      'telemetry.partition.maintenance',
      'maintenance',
      () => database`SELECT telemetry.ensure_current_partitions()`,
    );
  } catch (error) {
    logger.error('jobs.telemetry.partition_maintenance.failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await runWithTelemetry(
      'telemetry.retention.cleanup',
      'delete',
      () => database`SELECT * FROM telemetry.cleanup_expired()`,
    );
  } catch (error) {
    logger.error('jobs.telemetry.retention_cleanup.failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

let clickHouseProbeInFlight = false;
async function clickHouseAvailabilityTick(): Promise<void> {
  if (
    !alertEvaluator ||
    !usesClickHouseSignalStorage ||
    clickHouseProbeInFlight
  ) {
    return;
  }
  clickHouseProbeInFlight = true;
  try {
    await alertEvaluator.probeClickHouse();
  } catch {
    logger.error('jobs.clickhouse.availability_probe_failed', {
      code: 'observability_control_state_unavailable',
    });
  } finally {
    clickHouseProbeInFlight = false;
  }
}

if (scheduler) {
  try {
    await scheduler.synchronize();
    ready = true;
  } catch (error) {
    logger.error('jobs.scheduler.startup_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const scheduleTimer = scheduler
  ? setInterval(() => void scheduleTick(), env.JOB_SCHEDULE_INTERVAL_MS)
  : undefined;
const cleanupTimer = database
  ? setInterval(() => void cleanupTick(), env.JOB_CLEANUP_INTERVAL_MS)
  : undefined;
const clickHouseAvailabilityTimer =
  alertEvaluator && usesClickHouseSignalStorage
    ? setInterval(
        () => void clickHouseAvailabilityTick(),
        CLICKHOUSE_AVAILABILITY_PROBE_INTERVAL_MS,
      )
    : undefined;
scheduleTimer?.unref();
cleanupTimer?.unref();
clickHouseAvailabilityTimer?.unref();
if (clickHouseAvailabilityTimer) void clickHouseAvailabilityTick();

const app = createApp(env, {
  database,
  registry,
  isReady: () => ready,
  signalStore,
  telemetry,
});
const server = app.listen(env.JOBS_SERVICE_PORT);
console.log(
  `${env.serviceName} listening on http://localhost:${server.server?.port ?? env.JOBS_SERVICE_PORT}`,
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${env.serviceName} received ${signal}, shutting down`);
  if (scheduleTimer) clearInterval(scheduleTimer);
  if (cleanupTimer) clearInterval(cleanupTimer);
  if (clickHouseAvailabilityTimer) clearInterval(clickHouseAvailabilityTimer);
  await server.stop();
  await alertWorker?.stop();
  await ActivityLog.flush(env.LOG_FLUSH_TIMEOUT_MS);
  await telemetry?.shutdown(env.TELEMETRY_FLUSH_TIMEOUT_MS);
  if (!telemetry) await signalStore?.shutdown(env.LOG_FLUSH_TIMEOUT_MS);
  if (logDatabase) await closeDatabaseClient(logDatabase);
  if (telemetryDatabase) await closeDatabaseClient(telemetryDatabase);
  if (observabilityDatabase) await closeDatabaseClient(observabilityDatabase);
  if (database) await closeDatabaseClient(database);
}

process.on('SIGINT', () => void shutdown('SIGINT').then(() => process.exit(0)));
process.on(
  'SIGTERM',
  () => void shutdown('SIGTERM').then(() => process.exit(0)),
);
