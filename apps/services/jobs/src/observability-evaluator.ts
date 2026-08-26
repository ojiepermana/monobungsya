import { readFile } from 'node:fs/promises';
import { type DatabaseClient, withTransaction } from '#project/database';
import {
  enqueueJob,
  type JobRegistry,
  observabilityAlertNotificationContract,
} from '#project/jobs';
import {
  CLICKHOUSE_VERSION_MANIFEST,
  type ClickHouseSignalReader,
  type ObservabilitySignalReadMode,
} from '#project/observability';
import {
  type AlertState,
  type AlertTransition,
  evaluateAlertState,
  sha256,
  type Telemetry,
} from '#project/telemetry';

interface AlertRule {
  ruleId: string;
  title: string;
  severity: 'warning' | 'critical';
  metric: string;
  threshold: number;
  minimumOperations?: number;
  resourceName?: string;
  windowSeconds: number;
  requiredWindows: number;
}

interface RuleManifest {
  ruleVersion: string;
  rules: AlertRule[];
  manifestChecksum: string;
}

interface MetricRow {
  bucket_start: string;
  service_name: string;
  resource_kind: string;
  resource_name: string;
  series_fingerprint: string;
  count: number | string;
  sum: number | string;
  histogram_boundaries: unknown;
  histogram_counts: unknown;
  labels: unknown;
}

interface MetricGroup {
  service: string;
  resourceKind: string;
  resourceName: string;
  fingerprint: string;
  rows: MetricRow[];
}

interface MetricReadResult {
  rows: MetricRow[];
  available: boolean;
}

interface ClickHouseAvailabilityRow {
  database_count: number | string | null;
  disk_usage_percent: number | string | null;
  schema_version_column_count: number | string | null;
  server_version: string | null;
  table_count: number | string | null;
}

export interface ClickHouseAvailabilityProbeResult {
  available: boolean;
  diskUsagePercent: number | null;
  blocksBackfill: boolean;
}

export interface ObservabilityAlertEvaluatorOptions {
  readMode?: ObservabilitySignalReadMode;
  /**
   * Reader admitted by the runtime promotion gate for normal metric reads.
   */
  clickHouseReader?: ClickHouseSignalReader | null;
  /**
   * Bounded health-probe reader allowed during shadow writes. It must never
   * serve the configured public metric read mode.
   */
  clickHouseProbeReader?: ClickHouseSignalReader | null;
}

export const CLICKHOUSE_AVAILABILITY_PROBE_INTERVAL_MS = 30_000;

const CLICKHOUSE_PROBE_RULE_VERSION = 'clickhouse-health-v1';
const CLICKHOUSE_PROBE_MANIFEST_CHECKSUM = sha256(
  'observability.clickhouse.availability-and-disk.v1',
);
const CLICKHOUSE_PROBE_RESOURCE: Omit<MetricGroup, 'rows'> = {
  service: 'clickhouse',
  resourceKind: 'storage.node',
  resourceName: 'observability',
  fingerprint: sha256('observability.clickhouse.storage.node'),
};
const CLICKHOUSE_AVAILABILITY_RULE: AlertRule = {
  ruleId: 'observability.clickhouse.availability',
  title: 'ClickHouse availability',
  severity: 'critical',
  metric: 'observability.clickhouse.availability',
  threshold: 1,
  resourceName: 'observability',
  windowSeconds: 30,
  requiredWindows: 2,
};
const CLICKHOUSE_DISK_RULES: readonly AlertRule[] = [
  {
    ruleId: 'observability.clickhouse.disk.warning',
    title: 'ClickHouse disk usage warning',
    severity: 'warning',
    metric: 'observability.clickhouse.disk_usage_percent',
    threshold: 70,
    resourceName: 'observability',
    windowSeconds: 30,
    requiredWindows: 1,
  },
  {
    ruleId: 'observability.clickhouse.disk.firing',
    title: 'ClickHouse disk usage blocks backfill',
    severity: 'critical',
    metric: 'observability.clickhouse.disk_usage_percent',
    threshold: 80,
    resourceName: 'observability',
    windowSeconds: 30,
    requiredWindows: 1,
  },
  {
    ruleId: 'observability.clickhouse.disk.critical',
    title: 'ClickHouse disk usage critical',
    severity: 'critical',
    metric: 'observability.clickhouse.disk_usage_percent',
    threshold: 90,
    resourceName: 'observability',
    windowSeconds: 30,
    requiredWindows: 1,
  },
];
const CLICKHOUSE_AVAILABILITY_QUERY =
  'SELECT version() AS server_version, ' +
  "(SELECT count() FROM system.databases WHERE name = 'observability') AS database_count, " +
  "(SELECT count() FROM system.tables WHERE database = 'observability' AND name IN ('spans', 'metric_buckets', 'application_logs', 'access_logs')) AS table_count, " +
  "(SELECT count() FROM system.columns WHERE database = 'observability' AND table IN ('spans', 'metric_buckets', 'application_logs', 'access_logs') AND name = 'schema_version') AS schema_version_column_count, " +
  'max(if(total_space = 0, 0.0, (1.0 - free_space / total_space) * 100.0)) AS disk_usage_percent FROM system.disks';
const CLICKHOUSE_METRIC_BUCKETS_QUERY =
  'SELECT toString(bucket_start) AS bucket_start, service_name, resource_kind, resource_name, series_fingerprint, count, sum, histogram_boundaries, histogram_counts, labels ' +
  'FROM (SELECT * FROM observability.metric_buckets ' +
  "WHERE metric_name = {metric:String} AND bucket_start >= {from:DateTime64(6, 'UTC')} AND bucket_start < {to:DateTime64(6, 'UTC')} " +
  'ORDER BY bucket_start ASC, series_fingerprint ASC, flush_sequence DESC ' +
  'LIMIT 1 BY bucket_start, series_fingerprint) ORDER BY bucket_start ASC';

export class ObservabilityAlertEvaluator {
  constructor(
    private readonly database: DatabaseClient,
    private readonly registry: JobRegistry,
    private readonly rulesPath: string,
    private readonly telemetry?: Telemetry,
    options: ObservabilityAlertEvaluatorOptions = {},
  ) {
    this.readMode = options.readMode ?? 'postgres';
    this.clickHouseReader = options.clickHouseReader ?? null;
    this.clickHouseProbeReader = options.clickHouseProbeReader ?? null;
  }

  private readonly readMode: ObservabilitySignalReadMode;
  private readonly clickHouseReader: ClickHouseSignalReader | null;
  private readonly clickHouseProbeReader: ClickHouseSignalReader | null;

  async evaluate(now = new Date()): Promise<number> {
    const run = () => this.evaluateInternal(now);
    return this.telemetry
      ? this.telemetry.withSpan(
          {
            resourceKind: 'business.operation',
            resourceName: 'observability.alert.evaluate',
            operation: 'evaluate',
          },
          run,
        )
      : run();
  }

  private async evaluateInternal(now: Date): Promise<number> {
    const manifest = await loadManifest(this.rulesPath, this.telemetry);
    let transitions = 0;
    for (const rule of manifest.rules) {
      const from = new Date(now.getTime() - rule.windowSeconds * 1000);
      const metricRead = await this.readMetricRows(rule.metric, from, now);
      const groups = groupRows(metricRead.rows, rule);
      if (groups.length === 0) {
        groups.push({
          service: 'runtime',
          resourceKind: 'business.operation',
          resourceName: 'runtime',
          fingerprint: '0'.repeat(64),
          rows: [],
        });
      }

      for (const group of groups) {
        const metricEvaluation = evaluateMetric(rule, group, now);
        const evaluation = {
          ...metricEvaluation,
          hasData: metricRead.available && metricEvaluation.hasData,
        };
        const previous = await this.readState(
          rule.ruleId,
          manifest.ruleVersion,
          group.fingerprint,
        );
        const transition = evaluateAlertState(
          previous,
          evaluation,
          rule.requiredWindows,
        );
        await this.persist(
          rule,
          manifest.ruleVersion,
          manifest.manifestChecksum,
          group,
          transition,
        );
        if (transition.changed) transitions += 1;
      }
    }
    return transitions;
  }

  async probeClickHouse(
    now = new Date(),
  ): Promise<ClickHouseAvailabilityProbeResult> {
    const probe = await this.readClickHouseAvailability(now);
    const group: MetricGroup = { ...CLICKHOUSE_PROBE_RESOURCE, rows: [] };
    const evaluatedAt = now.toISOString();

    const availabilityState = await this.readState(
      CLICKHOUSE_AVAILABILITY_RULE.ruleId,
      CLICKHOUSE_PROBE_RULE_VERSION,
      group.fingerprint,
    );
    await this.persist(
      CLICKHOUSE_AVAILABILITY_RULE,
      CLICKHOUSE_PROBE_RULE_VERSION,
      CLICKHOUSE_PROBE_MANIFEST_CHECKSUM,
      group,
      evaluateClickHouseAvailability(
        availabilityState,
        probe.available,
        evaluatedAt,
      ),
    );

    for (const rule of CLICKHOUSE_DISK_RULES) {
      const previous = await this.readState(
        rule.ruleId,
        CLICKHOUSE_PROBE_RULE_VERSION,
        group.fingerprint,
      );
      const hasData = probe.available && probe.diskUsagePercent !== null;
      await this.persist(
        rule,
        CLICKHOUSE_PROBE_RULE_VERSION,
        CLICKHOUSE_PROBE_MANIFEST_CHECKSUM,
        group,
        evaluateAlertState(
          previous,
          {
            breached:
              hasData && probe.diskUsagePercent !== null
                ? probe.diskUsagePercent >= rule.threshold
                : false,
            hasData,
            evaluatedAt,
            evidenceBucket: hasData ? evaluatedAt : null,
          },
          rule.requiredWindows,
        ),
      );
    }

    return probe;
  }

  private async readMetricRows(
    metric: string,
    from: Date,
    to: Date,
  ): Promise<MetricReadResult> {
    if (this.readMode === 'clickhouse') {
      return this.readClickHouseMetricRows(metric, from, to);
    }
    const query = () =>
      this.database.unsafe(
        `SELECT bucket_start::text AS bucket_start, service_name, resource_kind, resource_name, series_fingerprint, count, sum, histogram_boundaries, histogram_counts, labels
         FROM "telemetry"."metric_buckets"
         WHERE metric_name = $1 AND bucket_start >= $2 AND bucket_start < $3
         ORDER BY bucket_start ASC`,
        [metric, from, to] as never[],
      ) as Promise<MetricRow[]>;
    const rows = await (this.telemetry
      ? this.telemetry.withSpan(
          {
            resourceKind: 'db.query',
            resourceName: 'observability.metric_buckets.read',
            operation: 'select',
          },
          query,
        )
      : query());
    return { rows, available: true };
  }

  private async readClickHouseMetricRows(
    metric: string,
    from: Date,
    to: Date,
  ): Promise<MetricReadResult> {
    const reader = this.clickHouseReader;
    if (!reader) return { rows: [], available: false };
    const query = () =>
      reader.queryRows<MetricRow>(CLICKHOUSE_METRIC_BUCKETS_QUERY, {
        range: { start: from, end: to },
        params: {
          metric,
          from: clickHouseTimestamp(from),
          to: clickHouseTimestamp(to),
        },
        settings: { max_execution_time: 5 },
      });
    try {
      const rows = await (this.telemetry
        ? this.telemetry.withSpan(
            {
              resourceKind: 'db.query',
              resourceName: 'observability.metric_buckets.read',
              operation: 'select',
            },
            query,
          )
        : query());
      return { rows, available: true };
    } catch {
      return { rows: [], available: false };
    }
  }

  private async readClickHouseAvailability(
    now: Date,
  ): Promise<ClickHouseAvailabilityProbeResult> {
    const reader = this.clickHouseProbeReader;
    if (!reader) {
      return {
        available: false,
        diskUsagePercent: null,
        blocksBackfill: true,
      };
    }
    const query = () =>
      reader.queryRows<ClickHouseAvailabilityRow>(
        CLICKHOUSE_AVAILABILITY_QUERY,
        {
          range: {
            start: new Date(
              now.getTime() - CLICKHOUSE_AVAILABILITY_PROBE_INTERVAL_MS,
            ),
            end: now,
          },
          settings: { max_execution_time: 5 },
        },
      );
    try {
      const rows = await (this.telemetry
        ? this.telemetry.withSpan(
            {
              resourceKind: 'db.query',
              resourceName: 'observability.clickhouse.availability',
              operation: 'select',
            },
            query,
          )
        : query());
      if (!rows[0]) {
        return {
          available: false,
          diskUsagePercent: null,
          blocksBackfill: true,
        };
      }
      const diskUsagePercent = validDiskUsage(rows[0]?.disk_usage_percent);
      const schemaReady =
        rows[0]?.server_version === CLICKHOUSE_VERSION_MANIFEST.serverVersion &&
        Number(rows[0]?.database_count) === 1 &&
        Number(rows[0]?.table_count) === 4 &&
        Number(rows[0]?.schema_version_column_count) === 4;
      return {
        available: schemaReady,
        diskUsagePercent,
        blocksBackfill:
          !schemaReady || (diskUsagePercent !== null && diskUsagePercent >= 80),
      };
    } catch {
      return {
        available: false,
        diskUsagePercent: null,
        blocksBackfill: true,
      };
    }
  }

  private async readState(
    ruleId: string,
    ruleVersion: string,
    fingerprint: string,
  ): Promise<AlertState | null> {
    const query = () =>
      this.database.unsafe(
        `SELECT status, consecutive_breach_windows, consecutive_healthy_windows, transition_sequence,
                first_breached_at::text AS first_breached_at,
                last_evaluated_at::text AS last_evaluated_at,
                evidence_bucket::text AS evidence_bucket,
                last_notified_at::text AS last_notified_at,
                resolved_at::text AS resolved_at
         FROM "telemetry"."alert_states"
         WHERE rule_id = $1 AND rule_version = $2 AND series_fingerprint = $3`,
        [ruleId, ruleVersion, fingerprint] as never[],
      ) as Promise<Array<Record<string, unknown>>>;
    const rows = await (this.telemetry
      ? this.telemetry.withSpan(
          {
            resourceKind: 'db.query',
            resourceName: 'observability.alert_state.read',
            operation: 'select',
          },
          query,
        )
      : query());
    const row = rows[0];
    if (!row) return null;
    return {
      status: String(row.status) as AlertState['status'],
      consecutiveBreachWindows: Number(row.consecutive_breach_windows ?? 0),
      consecutiveHealthyWindows: Number(row.consecutive_healthy_windows ?? 0),
      transitionSequence: Number(row.transition_sequence ?? 0),
      firstBreachedAt: nullableText(row.first_breached_at),
      lastEvaluatedAt: String(row.last_evaluated_at),
      evidenceBucket: nullableText(row.evidence_bucket),
      lastNotifiedAt: nullableText(row.last_notified_at),
      resolvedAt: nullableText(row.resolved_at),
    };
  }

  private async persist(
    rule: AlertRule,
    ruleVersion: string,
    manifestChecksum: string,
    group: MetricGroup,
    transition: AlertTransition,
  ): Promise<void> {
    const persist = () =>
      withTransaction(this.database, async (transaction) => {
        await transaction.unsafe(
          `INSERT INTO "telemetry"."alert_rules"
          (rule_id, rule_version, title, severity, metric, threshold, minimum_operations, resource_name, window_seconds, required_windows, manifest_checksum, active, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
         ON CONFLICT (rule_id, rule_version) DO UPDATE SET
           title = EXCLUDED.title,
           severity = EXCLUDED.severity,
           metric = EXCLUDED.metric,
           threshold = EXCLUDED.threshold,
           minimum_operations = EXCLUDED.minimum_operations,
           resource_name = EXCLUDED.resource_name,
           window_seconds = EXCLUDED.window_seconds,
           required_windows = EXCLUDED.required_windows,
           manifest_checksum = EXCLUDED.manifest_checksum,
           active = true,
           updated_at = EXCLUDED.updated_at`,
          [
            rule.ruleId,
            ruleVersion,
            rule.title,
            rule.severity,
            rule.metric,
            rule.threshold,
            rule.minimumOperations ?? null,
            rule.resourceName ?? null,
            rule.windowSeconds,
            rule.requiredWindows,
            manifestChecksum,
          ] as never[],
        );
        const notifiedAt = transition.shouldNotify
          ? transition.lastEvaluatedAt
          : transition.lastNotifiedAt;
        await transaction.unsafe(
          `INSERT INTO "telemetry"."alert_states"
          (rule_id, rule_version, series_fingerprint, service_name, resource_kind, resource_name, status, consecutive_breach_windows,
           consecutive_healthy_windows, transition_sequence, first_breached_at,
           last_evaluated_at, evidence_bucket, last_notified_at, resolved_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (rule_id, rule_version, series_fingerprint) DO UPDATE SET
           service_name = EXCLUDED.service_name,
           resource_kind = EXCLUDED.resource_kind,
           resource_name = EXCLUDED.resource_name,
           status = EXCLUDED.status,
           consecutive_breach_windows = EXCLUDED.consecutive_breach_windows,
           consecutive_healthy_windows = EXCLUDED.consecutive_healthy_windows,
           transition_sequence = EXCLUDED.transition_sequence,
           first_breached_at = EXCLUDED.first_breached_at,
           last_evaluated_at = EXCLUDED.last_evaluated_at,
           evidence_bucket = EXCLUDED.evidence_bucket,
           last_notified_at = EXCLUDED.last_notified_at,
           resolved_at = EXCLUDED.resolved_at`,
          [
            rule.ruleId,
            ruleVersion,
            group.fingerprint,
            group.service,
            group.resourceKind,
            group.resourceName,
            transition.status,
            transition.consecutiveBreachWindows,
            transition.consecutiveHealthyWindows,
            transition.transitionSequence,
            transition.firstBreachedAt,
            transition.lastEvaluatedAt,
            transition.evidenceBucket,
            notifiedAt,
            transition.resolvedAt,
          ] as never[],
        );

        if (!transition.shouldNotify) return;
        const service = group.service.slice(0, 50);
        const payload = {
          ruleId: rule.ruleId,
          ruleVersion,
          severity: rule.severity,
          service,
          transition: transition.status === 'resolved' ? 'resolved' : 'firing',
          transitionSequence: transition.transitionSequence,
          evaluatedAt: transition.lastEvaluatedAt,
        } as const;
        await enqueueJob(
          transaction,
          this.registry,
          {
            type: observabilityAlertNotificationContract.type,
            version: observabilityAlertNotificationContract.version,
            payload,
            sourceService: observabilityAlertNotificationContract.sourceService,
            targetService: observabilityAlertNotificationContract.targetService,
            idempotencyKey: `observability-alert:${rule.ruleId}:${ruleVersion}:${group.fingerprint}:${transition.transitionSequence}`,
            correlationId: null,
          },
          this.telemetry,
        );
      });
    if (this.telemetry) {
      await this.telemetry.withSpan(
        {
          resourceKind: 'db.query',
          resourceName: 'observability.alert_state.persist',
          operation: 'transaction',
        },
        persist,
      );
    } else {
      await persist();
    }
  }
}

async function loadManifest(
  path: string,
  telemetry?: Telemetry,
): Promise<RuleManifest> {
  const read = () => readFile(path, 'utf8');
  const source = telemetry
    ? await telemetry.withSpan(
        {
          resourceKind: 'fs.operation',
          resourceName: 'observability.alert_rules',
          operation: 'read',
        },
        read,
      )
    : await read();
  const value = JSON.parse(source) as RuleManifest;
  if (
    !value.ruleVersion ||
    !Array.isArray(value.rules) ||
    value.rules.length === 0 ||
    value.rules.some(
      (rule) =>
        !rule.ruleId ||
        !rule.title ||
        (rule.severity !== 'warning' && rule.severity !== 'critical') ||
        !rule.metric ||
        !Number.isFinite(rule.threshold) ||
        (rule.minimumOperations !== undefined &&
          (!Number.isInteger(rule.minimumOperations) ||
            rule.minimumOperations < 1)) ||
        (rule.resourceName !== undefined &&
          (typeof rule.resourceName !== 'string' ||
            rule.resourceName.length > 150)) ||
        !Number.isInteger(rule.windowSeconds) ||
        rule.windowSeconds < 60 ||
        !Number.isInteger(rule.requiredWindows) ||
        rule.requiredWindows < 1,
    )
  ) {
    throw new Error('observability alert manifest is invalid');
  }
  return { ...value, manifestChecksum: sha256(source) };
}

function groupRows(rows: MetricRow[], rule: AlertRule): MetricGroup[] {
  const groups = new Map<string, MetricGroup>();
  const aggregateByResource =
    rule.ruleId.includes('.error.') ||
    rule.ruleId.includes('.drop.') ||
    rule.ruleId.includes('.missing.') ||
    rule.ruleId.includes('.failure.');
  const filteredRows = rule.resourceName
    ? rows.filter((row) => row.resource_name === rule.resourceName)
    : rows;
  for (const row of filteredRows) {
    const key = aggregateByResource
      ? `${row.service_name}|${row.resource_kind}|${row.resource_name}`
      : `${row.service_name}|${row.resource_kind}|${row.resource_name}|${row.series_fingerprint}`;
    const fingerprint = aggregateByResource
      ? sha256(
          `alert:${rule.ruleId}:${row.service_name}:${row.resource_kind}:${row.resource_name}`,
        )
      : String(row.series_fingerprint).trim();
    const group = groups.get(key) ?? {
      service: row.service_name,
      resourceKind: row.resource_kind,
      resourceName: row.resource_name,
      fingerprint,
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function evaluateMetric(
  rule: AlertRule,
  group: MetricGroup,
  now: Date,
): {
  breached: boolean;
  hasData: boolean;
  evaluatedAt: string;
  evidenceBucket: string | null;
} {
  const operationRows = group.rows;
  const count = operationRows.reduce(
    (sum, row) => sum + Number(row.count ?? 0),
    0,
  );
  const sum = operationRows.reduce(
    (total, row) => total + Number(row.sum ?? 0),
    0,
  );
  const errorCount = operationRows.reduce((total, row) => {
    const labels = parseJson(row.labels) as Record<string, unknown>;
    return labels.status === 'error' ? total + Number(row.count ?? 0) : total;
  }, 0);
  const value = rule.ruleId.includes('.missing.')
    ? Math.max(
        0,
        Math.ceil(rule.windowSeconds / 60) -
          new Set(operationRows.map((row) => row.bucket_start)).size,
      )
    : rule.ruleId.includes('.error.')
      ? count > 0
        ? errorCount / count
        : 0
      : rule.ruleId.includes('.latency.')
        ? histogramQuantile(operationRows, 0.95)
        : sum;
  const hasData = rule.ruleId.includes('.missing.')
    ? true
    : operationRows.length > 0 && count > 0;
  const enoughOperations =
    rule.minimumOperations === undefined || count >= rule.minimumOperations;
  return {
    breached: hasData && enoughOperations && value > rule.threshold,
    hasData,
    evaluatedAt: now.toISOString(),
    evidenceBucket: operationRows.at(-1)?.bucket_start
      ? new Date(String(operationRows.at(-1)?.bucket_start)).toISOString()
      : null,
  };
}

function histogramQuantile(rows: MetricRow[], quantile: number): number {
  const combined = new Map<number, number>();
  let total = 0;
  for (const row of rows) {
    const boundaries = toNumbers(row.histogram_boundaries);
    const counts = toNumbers(row.histogram_counts);
    for (let index = 0; index < counts.length; index += 1) {
      const boundary = boundaries[index] ?? Number.POSITIVE_INFINITY;
      const count = counts[index] ?? 0;
      combined.set(boundary, (combined.get(boundary) ?? 0) + count);
      total += count;
    }
  }
  if (total === 0) return 0;
  let seen = 0;
  for (const [boundary, count] of [...combined.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    seen += count;
    if (seen >= total * quantile) return boundary;
  }
  return Number.POSITIVE_INFINITY;
}

function toNumbers(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  if (typeof value === 'string') {
    return value
      .replace(/^\{|\}$/g, '')
      .split(',')
      .map((part) => Number(part.replaceAll('"', '')))
      .filter(Number.isFinite);
  }
  return [];
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function clickHouseTimestamp(value: Date): string {
  return value.toISOString().replace('T', ' ').replace('Z', '');
}

function validDiskUsage(value: unknown): number | null {
  const usage = Number(value);
  return Number.isFinite(usage) && usage >= 0 && usage <= 100 ? usage : null;
}

function evaluateClickHouseAvailability(
  previous: AlertState | null,
  available: boolean,
  evaluatedAt: string,
): AlertTransition {
  const current: AlertState = previous ?? {
    status: 'pending',
    consecutiveBreachWindows: 0,
    consecutiveHealthyWindows: 0,
    transitionSequence: 0,
    firstBreachedAt: null,
    lastEvaluatedAt: evaluatedAt,
    evidenceBucket: null,
    lastNotifiedAt: null,
    resolvedAt: null,
  };

  if (!available) {
    const consecutiveBreachWindows = current.consecutiveBreachWindows + 1;
    const status = consecutiveBreachWindows >= 2 ? 'firing' : 'pending';
    const changed = status !== current.status;
    return {
      ...current,
      status,
      consecutiveBreachWindows,
      consecutiveHealthyWindows: 0,
      transitionSequence: changed
        ? current.transitionSequence + 1
        : current.transitionSequence,
      firstBreachedAt:
        current.status === 'resolved' || current.status === 'unknown'
          ? evaluatedAt
          : (current.firstBreachedAt ?? evaluatedAt),
      lastEvaluatedAt: evaluatedAt,
      evidenceBucket: evaluatedAt,
      resolvedAt: null,
      changed,
      shouldNotify: changed && status === 'firing',
    };
  }

  const wasFiring = current.status === 'firing';
  const consecutiveHealthyWindows = wasFiring
    ? current.consecutiveHealthyWindows + 1
    : 0;
  const resolved = wasFiring && consecutiveHealthyWindows >= 3;
  const status = resolved ? 'resolved' : wasFiring ? 'firing' : 'resolved';
  const changed = status !== current.status;
  return {
    ...current,
    status,
    consecutiveBreachWindows: 0,
    consecutiveHealthyWindows,
    transitionSequence: changed
      ? current.transitionSequence + 1
      : current.transitionSequence,
    lastEvaluatedAt: evaluatedAt,
    evidenceBucket: evaluatedAt,
    resolvedAt: resolved ? evaluatedAt : current.resolvedAt,
    changed,
    shouldNotify: resolved,
  };
}
