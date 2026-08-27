import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabaseClient, createDatabaseClient } from '#project/database';
import {
  CLICKHOUSE_VERSION_MANIFEST,
  ClickHouseClient,
  type ClickHouseClientOptions,
  createConfiguredObservabilitySignalStore,
  discoverClickHouseMigrations,
  isCompatibleClickHouseVersion,
  OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
  runClickHouseMigrations,
  SignalDeliveryError,
  verifyClickHouseSignalSchema,
} from '#project/observability';

const STARTUP_TIMEOUT_MS = 15_000;

export interface LocalClickHouseServiceCredentials {
  bootstrap: ClickHouseClientOptions;
  migrator: ClickHouseClientOptions;
  writer: ClickHouseClientOptions;
  readiness: ClickHouseClientOptions;
  reader: ClickHouseClientOptions;
}

const LOCAL_CLICKHOUSE_IDENTITIES = {
  migrator: {
    username: 'local_observability_migrator',
    password: 'local-observability-migrator',
    role: 'project_observability_migrator',
  },
  writer: {
    username: 'local_observability_writer',
    password: 'local-observability-writer',
    role: 'project_observability_writer',
  },
  readiness: {
    username: 'local_observability_readiness',
    password: 'local-observability-readiness',
    role: 'project_observability_readiness',
  },
  reader: {
    username: 'local_observability_reader',
    password: 'local-observability-reader',
    role: 'project_observability_reader',
  },
} as const;

export function localClickHouseServiceCredentials(
  url: string,
): LocalClickHouseServiceCredentials {
  return {
    bootstrap: { url, username: 'default', password: '' },
    migrator: { url, ...LOCAL_CLICKHOUSE_IDENTITIES.migrator },
    writer: { url, ...LOCAL_CLICKHOUSE_IDENTITIES.writer },
    readiness: { url, ...LOCAL_CLICKHOUSE_IDENTITIES.readiness },
    reader: { url, ...LOCAL_CLICKHOUSE_IDENTITIES.reader },
  };
}

/** The temporary server is bootstrapped once, then only role-scoped users run. */
export function localClickHouseProvisioningStatements(): readonly string[] {
  return Object.values(LOCAL_CLICKHOUSE_IDENTITIES).flatMap((identity) => [
    `CREATE USER IF NOT EXISTS ${identity.username} IDENTIFIED WITH sha256_password BY '${identity.password}'`,
    `GRANT ${identity.role} TO ${identity.username}`,
    `ALTER USER ${identity.username} DEFAULT ROLE ${identity.role}`,
  ]);
}

export function parseClickHouseVersion(output: string): string | null {
  return output.match(/\b(\d+\.\d+\.\d+\.\d+)\b/)?.[1] ?? null;
}

export function assertPinnedClickHouseVersion(output: string): string {
  const version = parseClickHouseVersion(output);
  if (
    version === null ||
    !isCompatibleClickHouseVersion(
      version,
      CLICKHOUSE_VERSION_MANIFEST.serverVersion,
    )
  ) {
    throw new Error(
      `ClickHouse version ${CLICKHOUSE_VERSION_MANIFEST.serverVersion} is required; found ${version ?? 'unknown'}`,
    );
  }
  return version;
}

export function localClickHouseQueryLogHasSevenDayRetention(
  definition: string,
): boolean {
  const normalized = definition.replace(/[\s`]/g, '').toLowerCase();
  return (
    normalized.includes('ttlevent_date+interval7daydelete') ||
    normalized.includes('ttlevent_date+tointervalday(7)')
  );
}

export function localClickHouseQueryLogSmokeStatements(): readonly [
  string,
  string,
] {
  return ['SYSTEM FLUSH LOGS', 'SHOW CREATE TABLE system.query_log'];
}

/**
 * ClickHouse enables its watchdog when all standard streams are piped. The
 * local runner needs the actual server to remain a child it can stop and whose
 * temporary directory it can remove, so disable that production watchdog for
 * this short lived development process only.
 */
export function localClickHouseServerEnvironment(
  environment: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  return {
    ...environment,
    CLICKHOUSE_WATCHDOG_ENABLE: '0',
  };
}

function localConfig(
  directory: string,
  httpPort: number,
  tcpPort: number,
): string {
  return `<?xml version="1.0"?>
<clickhouse>
  <logger><level>warning</level><log>${directory}/server.log</log><errorlog>${directory}/server.err.log</errorlog></logger>
  <http_port>${httpPort}</http_port>
  <tcp_port>${tcpPort}</tcp_port>
  <listen_host>127.0.0.1</listen_host>
  <path>${directory}/data/</path>
  <tmp_path>${directory}/tmp/</tmp_path>
  <user_files_path>${directory}/user_files/</user_files_path>
  <format_schema_path>${directory}/format_schemas/</format_schema_path>
  <access_control_path>${directory}/access/</access_control_path>
  <query_log>
    <database>system</database>
    <table>query_log</table>
    <partition_by>toYYYYMM(event_date)</partition_by>
    <ttl>event_date + INTERVAL 7 DAY DELETE</ttl>
    <flush_interval_milliseconds>7500</flush_interval_milliseconds>
    <max_size_rows>1048576</max_size_rows>
    <reserved_size_rows>8192</reserved_size_rows>
    <buffer_size_rows_flush_threshold>524288</buffer_size_rows_flush_threshold>
    <flush_on_crash>false</flush_on_crash>
  </query_log>
  <user_directories>
    <users_xml><path>${directory}/users.xml</path></users_xml>
    <local_directory><path>${directory}/access/</path></local_directory>
  </user_directories>
</clickhouse>`;
}

function localUsers(): string {
  return `<?xml version="1.0"?>
<clickhouse>
  <users>
    <default>
      <password></password>
      <networks><ip>::/0</ip></networks>
      <profile>default</profile>
      <quota>default</quota>
      <access_management>1</access_management>
      <named_collection_control>1</named_collection_control>
    </default>
  </users>
  <profiles><default/></profiles>
  <quotas><default><interval><duration>3600</duration><queries>0</queries><errors>0</errors><result_rows>0</result_rows><read_rows>0</read_rows><execution_time>0</execution_time></interval></default></quotas>
</clickhouse>`;
}

function portFromEnvironment(name: string, fallback: number): number {
  const value = Number(Bun.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return value;
}

async function binaryVersion(binary: string): Promise<string> {
  const child = Bun.spawn([binary, '--version'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0)
    throw new Error('Unable to run ClickHouse binary version check');
  return `${stdout}\n${stderr}`;
}

async function waitUntilReady(url: string): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/?query=SELECT%201`);
      if (response.ok && (await response.text()).trim() === '1') return;
    } catch {
      // The binary owns startup timing. Retrying is bounded by the deadline.
    }
    await Bun.sleep(100);
  }
  throw new Error(
    `ClickHouse did not become ready within ${STARTUP_TIMEOUT_MS}ms`,
  );
}

async function provisionLocalServiceIdentities(
  bootstrap: ClickHouseClient,
): Promise<void> {
  for (const query of localClickHouseProvisioningStatements()) {
    await bootstrap.execute({ database: null, query });
  }
}

async function migrateLocalServer(
  url: string,
  verifyRepeatedRun = false,
): Promise<void> {
  const controlUrl = Bun.env.TELEMETRY_DATABASE_URL ?? Bun.env.DATABASE_URL;
  if (!controlUrl) {
    throw new Error(
      '--migrate requires TELEMETRY_DATABASE_URL or DATABASE_URL',
    );
  }
  const controlDatabase = createDatabaseClient(controlUrl);
  const credentials = localClickHouseServiceCredentials(url);
  try {
    const firstRun = await runClickHouseMigrations({
      controlDatabase,
      client: new ClickHouseClient(credentials.bootstrap),
      expectedServerVersion: CLICKHOUSE_VERSION_MANIFEST.serverVersion,
      schemaVersion: CLICKHOUSE_VERSION_MANIFEST.schema.maximum,
    });
    console.log(
      `ClickHouse migration target ${firstRun.targetId}: ${firstRun.applied.length} applied, ${firstRun.skipped.length} skipped`,
    );
    await provisionLocalServiceIdentities(
      new ClickHouseClient(credentials.bootstrap),
    );
    if (!verifyRepeatedRun) return;

    const repeatedRun = await runClickHouseMigrations({
      controlDatabase,
      client: new ClickHouseClient(credentials.migrator),
      expectedServerVersion: CLICKHOUSE_VERSION_MANIFEST.serverVersion,
      schemaVersion: CLICKHOUSE_VERSION_MANIFEST.schema.maximum,
    });
    if (
      repeatedRun.targetId !== firstRun.targetId ||
      repeatedRun.applied.length !== 0
    ) {
      throw new Error(
        'Repeated ClickHouse migration verification did not produce a same target no op',
      );
    }
    console.log(
      `ClickHouse repeated migration target ${repeatedRun.targetId}: ${repeatedRun.applied.length} applied, ${repeatedRun.skipped.length} skipped`,
    );
  } finally {
    await closeDatabaseClient(controlDatabase);
  }
}

async function schemaSmokeLocalServer(url: string): Promise<void> {
  const client = new ClickHouseClient(
    localClickHouseServiceCredentials(url).bootstrap,
  );
  const migrations = await discoverClickHouseMigrations();
  for (const migration of migrations) {
    try {
      await client.execute({ database: null, query: migration.sql });
    } catch {
      throw new Error(
        `Pinned ClickHouse schema smoke migration ${migration.version} ${migration.name} failed`,
      );
    }
  }
  const readiness = await verifyClickHouseSignalSchema(client, {
    expectedServerVersion: CLICKHOUSE_VERSION_MANIFEST.serverVersion,
    schemaVersion: CLICKHOUSE_VERSION_MANIFEST.schema.maximum,
    requireWriterSettings: false,
  });
  if (!readiness.available) {
    throw new Error(
      `Pinned ClickHouse schema smoke failed: ${readiness.failureCode}`,
    );
  }
  const [flushQueryLog, showQueryLog] =
    localClickHouseQueryLogSmokeStatements();
  await client.execute({ database: null, query: flushQueryLog });
  const queryLog = await client.execute({
    database: null,
    query: showQueryLog,
  });
  if (!localClickHouseQueryLogHasSevenDayRetention(queryLog)) {
    throw new Error('Pinned ClickHouse query log retention smoke failed');
  }
  console.log('Pinned ClickHouse schema smoke succeeded');
}

function unixMicros(timestamp: string): number {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) {
    throw new Error(
      'Pinned ClickHouse adapter contract received an invalid timestamp',
    );
  }
  return value * 1_000;
}

function equalRowValue(actual: unknown, expected: unknown): boolean {
  if (typeof expected === 'number') return Number(actual) === expected;
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      actual.every((value, index) => equalRowValue(value, expected[index]))
    );
  }
  return actual === expected;
}

function assertRowFields(
  row: Record<string, unknown> | undefined,
  expected: Readonly<Record<string, unknown>>,
  signal: string,
): void {
  if (!row) {
    throw new Error(
      `Pinned ClickHouse adapter contract did not read ${signal}`,
    );
  }
  for (const [field, value] of Object.entries(expected)) {
    if (!equalRowValue(row[field], value)) {
      throw new Error(
        `Pinned ClickHouse adapter contract mapped ${signal}.${field} incorrectly`,
      );
    }
  }
}

async function assertUnauthorized(
  action: () => Promise<unknown>,
  boundary: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (
      error instanceof SignalDeliveryError &&
      error.code === 'clickhouse_unauthorized'
    ) {
      return;
    }
    throw new Error(
      `Pinned ClickHouse adapter contract did not enforce ${boundary}`,
    );
  }
  throw new Error(
    `Pinned ClickHouse adapter contract did not reject ${boundary}`,
  );
}

async function assertLocalRoleBoundaries(
  credentials: LocalClickHouseServiceCredentials,
): Promise<void> {
  const writer = new ClickHouseClient(credentials.writer);
  const readiness = new ClickHouseClient(credentials.readiness);
  const reader = new ClickHouseClient(credentials.reader);
  const migrator = new ClickHouseClient(credentials.migrator);
  await Promise.all([
    assertUnauthorized(
      () => writer.queryRows('SELECT count() AS count FROM spans'),
      'writer Signal SELECT',
    ),
    assertUnauthorized(
      () => readiness.queryRows('SELECT count() AS count FROM spans'),
      'readiness Signal SELECT',
    ),
    assertUnauthorized(
      () =>
        reader.insert({
          table: 'spans',
          batchId: 'local-reader-must-not-insert',
          body: '{}\n',
        }),
      'reader Signal INSERT',
    ),
    assertUnauthorized(
      () => migrator.queryRows('SELECT count() AS count FROM spans'),
      'migrator Signal SELECT',
    ),
    assertUnauthorized(
      () =>
        migrator.insert({
          table: 'spans',
          batchId: 'local-migrator-must-not-insert',
          body: '{}\n',
        }),
      'migrator Signal INSERT',
    ),
  ]);
}

async function adapterContractLocalServer(url: string): Promise<void> {
  const now = new Date();
  const eventAt = new Date(now.getTime() - 1_000).toISOString();
  const marker = `local-adapter-${Bun.randomUUIDv7()}`;
  const spanId = 'b'.repeat(16);
  const traceId = 'a'.repeat(32);
  const seriesFingerprint = 'c'.repeat(64);
  const eventAtUs = unixMicros(eventAt);
  const ingestedAtUs = unixMicros(now.toISOString());
  const credentials = localClickHouseServiceCredentials(url);
  const reader = new ClickHouseClient(credentials.reader);
  const store = await createConfiguredObservabilitySignalStore({
    writeMode: 'clickhouse',
    readMode: 'clickhouse',
    clickhouse: credentials.writer,
    readinessClickhouse: credentials.readiness,
    verifyClickHouse: (readinessClient) =>
      verifyClickHouseSignalSchema(readinessClient, {
        expectedServerVersion: CLICKHOUSE_VERSION_MANIFEST.serverVersion,
        schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
      }),
    now: () => now,
    flushIntervalMs: 60_000,
  });
  const applicationLogId = Bun.randomUUIDv7();
  const accessLogId = Bun.randomUUIDv7();
  try {
    await assertLocalRoleBoundaries(credentials);
    const appendResults = [
      store.append({
        kind: 'span',
        traceId,
        spanId,
        parentSpanId: null,
        correlationId: marker,
        requestId: marker,
        runId: null,
        serviceName: marker,
        serviceInstanceId: 'local-adapter-contract',
        resourceKind: 'http.server',
        resourceName: 'observability-adapter-contract',
        operation: 'GET',
        status: 'ok',
        samplingReason: 'deterministic',
        attributes: { adapter_contract: true },
        errorType: null,
        startedAt: eventAt,
        finishedAt: now.toISOString(),
        durationNs: 1_000_000_000,
        schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
      }),
      store.append({
        kind: 'metric_bucket',
        bucketStart: eventAt,
        bucketWidthSeconds: 60,
        seriesFingerprint,
        flushSequence: 1,
        serviceName: marker,
        serviceInstanceId: 'local-adapter-contract',
        resourceKind: 'http.server',
        resourceName: 'observability-adapter-contract',
        metricName: 'observability.adapter.contract',
        metricKind: 'counter',
        unit: 'count',
        count: 1,
        sum: 1,
        min: 1,
        max: 1,
        histogramBoundaries: [],
        histogramCounts: [1],
        labels: { marker },
        schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
      }),
      store.append({
        kind: 'application_log',
        id: applicationLogId,
        level: 'info',
        channel: 'observability',
        category: 'verification',
        event: marker,
        module: 'adapter-contract',
        message: 'local adapter contract verification',
        context: { marker },
        exceptionClass: null,
        exceptionMessage: null,
        stackTrace: null,
        actorUserId: null,
        actorName: null,
        actorEmail: null,
        entityType: null,
        entityId: null,
        referenceNo: null,
        branchCode: null,
        requestId: marker,
        traceId: null,
        runtimeTraceId: traceId,
        runtimeSpanId: spanId,
        sessionId: null,
        ipAddress: null,
        userAgent: null,
        occurredAt: eventAt,
        createdAt: now.toISOString(),
        schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
      }),
      store.append({
        kind: 'access_log',
        id: accessLogId,
        event: marker,
        outcome: 'success',
        authenticationMethod: null,
        accessChannel: 'internal',
        guard: null,
        actorUserId: null,
        actorName: null,
        actorEmail: null,
        branchCode: null,
        ipAddress: null,
        forwardedIp: null,
        userAgent: null,
        deviceName: null,
        platform: null,
        browser: null,
        sessionId: null,
        requestId: marker,
        traceId: null,
        runtimeTraceId: traceId,
        runtimeSpanId: spanId,
        routeName: 'observability-adapter-contract',
        path: '/internal/observability/storage-health',
        method: 'GET',
        httpStatus: 200,
        failureReason: null,
        metadata: { marker },
        accessedAt: eventAt,
        createdAt: now.toISOString(),
        schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
      }),
    ];
    if (appendResults.some((result) => result.status !== 'accepted')) {
      throw new Error(
        `Pinned ClickHouse adapter contract rejected a valid Signal: ${store.diagnostics().failureCode ?? 'unknown'}`,
      );
    }

    const flush = await store.flush(5_000);
    if (
      flush.written !== 4 ||
      flush.dropped !== 0 ||
      flush.failed ||
      flush.timedOut
    ) {
      throw new Error(
        'Pinned ClickHouse adapter contract did not receive four acknowledged Signal rows',
      );
    }
    if (!store.diagnostics().lastAcknowledgedAt) {
      throw new Error(
        'Pinned ClickHouse adapter contract did not record an acknowledgement',
      );
    }
    const [spans, metrics, applicationLogs, accessLogs] = await Promise.all([
      reader.queryRows<Record<string, unknown>>(
        'SELECT trace_id, span_id, correlation_id, request_id, service_name, service_instance_id, resource_kind, resource_name, operation, status, sampling_reason, attributes, duration_ns, schema_version, toUnixTimestamp64Micro(started_at) AS started_at_us, toUnixTimestamp64Micro(finished_at) AS finished_at_us, toUnixTimestamp64Micro(ingested_at) AS ingested_at_us, write_version FROM spans WHERE trace_id = {traceId:String} AND span_id = {spanId:String} AND toUnixTimestamp64Micro(started_at) = {eventAtUs:UInt64}',
        { params: { traceId, spanId, eventAtUs } },
      ),
      reader.queryRows<Record<string, unknown>>(
        'SELECT bucket_width_seconds, series_fingerprint, flush_sequence, service_name, service_instance_id, resource_kind, resource_name, metric_name, metric_kind, unit, count, sum, min, max, histogram_boundaries, histogram_counts, labels, schema_version, toUnixTimestamp64Micro(bucket_start) AS bucket_start_us, toUnixTimestamp64Micro(ingested_at) AS ingested_at_us FROM metric_buckets WHERE series_fingerprint = {seriesFingerprint:String} AND toUnixTimestamp64Micro(bucket_start) = {eventAtUs:UInt64}',
        { params: { seriesFingerprint, eventAtUs } },
      ),
      reader.queryRows<Record<string, unknown>>(
        'SELECT id, level, channel, category, event, module, message, context, request_id, runtime_trace_id, runtime_span_id, schema_version, toUnixTimestamp64Micro(occurred_at) AS occurred_at_us, toUnixTimestamp64Micro(created_at) AS created_at_us, toUnixTimestamp64Micro(ingested_at) AS ingested_at_us, write_version FROM application_logs WHERE id = {id:UUID} AND toUnixTimestamp64Micro(occurred_at) = {eventAtUs:UInt64}',
        { params: { id: applicationLogId, eventAtUs } },
      ),
      reader.queryRows<Record<string, unknown>>(
        'SELECT id, event, outcome, access_channel, request_id, runtime_trace_id, runtime_span_id, route_name, path, method, http_status, metadata, schema_version, toUnixTimestamp64Micro(accessed_at) AS accessed_at_us, toUnixTimestamp64Micro(created_at) AS created_at_us, toUnixTimestamp64Micro(ingested_at) AS ingested_at_us, write_version FROM access_logs WHERE id = {id:UUID} AND toUnixTimestamp64Micro(accessed_at) = {eventAtUs:UInt64}',
        { params: { id: accessLogId, eventAtUs } },
      ),
    ]);
    if (
      spans.length !== 1 ||
      metrics.length !== 1 ||
      applicationLogs.length !== 1 ||
      accessLogs.length !== 1
    ) {
      throw new Error(
        'Pinned ClickHouse adapter contract did not read back exactly four Signal rows',
      );
    }
    assertRowFields(
      spans[0],
      {
        trace_id: traceId,
        span_id: spanId,
        correlation_id: marker,
        request_id: marker,
        service_name: marker,
        service_instance_id: 'local-adapter-contract',
        resource_kind: 'http.server',
        resource_name: 'observability-adapter-contract',
        operation: 'GET',
        status: 'ok',
        sampling_reason: 'deterministic',
        attributes: '{"adapter_contract":true}',
        duration_ns: 1_000_000_000,
        schema_version: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
        started_at_us: eventAtUs,
        finished_at_us: ingestedAtUs,
        ingested_at_us: ingestedAtUs,
        write_version: ingestedAtUs,
      },
      'span',
    );
    assertRowFields(
      metrics[0],
      {
        bucket_width_seconds: 60,
        series_fingerprint: seriesFingerprint,
        flush_sequence: 1,
        service_name: marker,
        service_instance_id: 'local-adapter-contract',
        resource_kind: 'http.server',
        resource_name: 'observability-adapter-contract',
        metric_name: 'observability.adapter.contract',
        metric_kind: 'counter',
        unit: 'count',
        count: 1,
        sum: 1,
        min: 1,
        max: 1,
        histogram_boundaries: [],
        histogram_counts: [1],
        labels: `{"marker":"${marker}"}`,
        schema_version: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
        bucket_start_us: eventAtUs,
        ingested_at_us: ingestedAtUs,
      },
      'metric bucket',
    );
    assertRowFields(
      applicationLogs[0],
      {
        id: applicationLogId,
        level: 'info',
        channel: 'observability',
        category: 'verification',
        event: marker,
        module: 'adapter-contract',
        message: 'local adapter contract verification',
        context: `{"marker":"${marker}"}`,
        request_id: marker,
        runtime_trace_id: traceId,
        runtime_span_id: spanId,
        schema_version: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
        occurred_at_us: eventAtUs,
        created_at_us: ingestedAtUs,
        ingested_at_us: ingestedAtUs,
        write_version: ingestedAtUs,
      },
      'application log',
    );
    assertRowFields(
      accessLogs[0],
      {
        id: accessLogId,
        event: marker,
        outcome: 'success',
        access_channel: 'internal',
        request_id: marker,
        runtime_trace_id: traceId,
        runtime_span_id: spanId,
        route_name: 'observability-adapter-contract',
        path: '/internal/observability/storage-health',
        method: 'GET',
        http_status: 200,
        metadata: `{"marker":"${marker}"}`,
        schema_version: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
        accessed_at_us: eventAtUs,
        created_at_us: ingestedAtUs,
        ingested_at_us: ingestedAtUs,
        write_version: ingestedAtUs,
      },
      'access log',
    );
    console.log('Pinned ClickHouse adapter contract succeeded');
  } finally {
    await store.shutdown();
  }
}

async function main(): Promise<void> {
  const binary = Bun.env.CLICKHOUSE_BIN ?? Bun.which('clickhouse');
  if (!binary) {
    throw new Error(
      `Pinned ClickHouse ${CLICKHOUSE_VERSION_MANIFEST.serverVersion} is not installed; set CLICKHOUSE_BIN to the native binary`,
    );
  }
  assertPinnedClickHouseVersion(await binaryVersion(binary));

  const httpPort = portFromEnvironment('CLICKHOUSE_HTTP_PORT', 8123);
  const tcpPort = portFromEnvironment('CLICKHOUSE_TCP_PORT', 9000);
  const keepTemporaryDirectory = Bun.env.CLICKHOUSE_KEEP_TEMP === 'true';
  const directory = await mkdtemp(join(tmpdir(), 'project-clickhouse-'));
  const endpoint = `http://127.0.0.1:${httpPort}`;
  await Promise.all([
    mkdir(join(directory, 'data'), { recursive: true }),
    mkdir(join(directory, 'tmp'), { recursive: true }),
    mkdir(join(directory, 'user_files'), { recursive: true }),
    mkdir(join(directory, 'format_schemas'), { recursive: true }),
    mkdir(join(directory, 'access'), { recursive: true }),
  ]);
  await Bun.write(
    join(directory, 'config.xml'),
    localConfig(directory, httpPort, tcpPort),
  );
  await Bun.write(join(directory, 'users.xml'), localUsers());

  const server = Bun.spawn(
    [binary, 'server', '--config-file', join(directory, 'config.xml')],
    {
      env: localClickHouseServerEnvironment(),
      stdout: 'inherit',
      stderr: 'inherit',
    },
  );
  let stopped = false;
  const cleanup = async () => {
    if (stopped) return;
    stopped = true;
    let serverExited = false;
    const exited = server.exited
      .catch(() => undefined)
      .finally(() => {
        serverExited = true;
      });
    try {
      process.kill(server.pid, 'SIGTERM');
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ESRCH'
      ) {
        throw error;
      }
    }
    await Promise.race([exited, Bun.sleep(5_000)]);
    if (!serverExited) {
      process.kill(server.pid, 'SIGKILL');
      await exited;
    }
    if (!keepTemporaryDirectory) {
      await rm(directory, { recursive: true, force: true });
      return;
    }
    console.warn(`ClickHouse temporary directory retained at ${directory}`);
  };

  try {
    await waitUntilReady(endpoint);
    console.log(`Pinned ClickHouse ready at ${endpoint}`);
    const verifyMigrationTarget = Bun.argv.includes('--migrate-twice');
    const adapterContract = Bun.argv.includes('--adapter-contract');
    const migrateOnly =
      Bun.argv.includes('--migrate') ||
      verifyMigrationTarget ||
      adapterContract;
    const schemaSmoke = Bun.argv.includes('--schema-smoke');
    const smoke = Bun.argv.includes('--smoke');
    if (migrateOnly) {
      await migrateLocalServer(endpoint, verifyMigrationTarget);
    }
    if (schemaSmoke) {
      await schemaSmokeLocalServer(endpoint);
      return;
    }
    if (adapterContract) {
      await adapterContractLocalServer(endpoint);
      return;
    }
    if (smoke) {
      const response = await fetch(
        `${endpoint}/?query=SELECT%20version()%20FORMAT%20JSONEachRow`,
      );
      if (!response.ok) {
        throw new Error('Pinned ClickHouse smoke query failed');
      }
      console.log('Pinned ClickHouse smoke query succeeded');
      return;
    }
    if (migrateOnly) return;
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
  } finally {
    await cleanup();
  }
}

if (import.meta.main) {
  void main().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : 'Unable to start local ClickHouse',
    );
    process.exitCode = 1;
  });
}
