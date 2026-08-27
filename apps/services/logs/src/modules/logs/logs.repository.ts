import type { DatabaseClient } from '#project/database';
import { isoFromDbTimestamp } from '#project/logger';
import type {
  ClickHouseSignalReader,
  ObservabilitySignalReadMode,
} from '#project/observability';
import type { TelemetryRuntime } from '#project/telemetry';
import { ClickHouseLogsSignalReader } from './logs.clickhouse';
import {
  mapAccessLogRow,
  mapApplicationLogRow,
  textOrNull,
} from './logs.mapping';
import type {
  AccessLogItem,
  ApplicationLogItem,
  AuditTrailItem,
  SignalAccessLogsQuery,
  SignalAccessLogsResult,
  SignalApplicationLogsQuery,
  SignalApplicationLogsResult,
} from './logs.types';

export const LOGS_PER_PAGE = 100;

interface ListPage<Item> {
  items: Item[];
  total: number;
}

interface LogsRepositoryOptions {
  clickhouseReader?: ClickHouseSignalReader | null;
  readMode?: ObservabilitySignalReadMode;
}

/**
 * Column whitelists per table. Only names from these lists are interpolated
 * into SQL text; every user supplied value is bound as a parameter.
 */
const AUDIT_SEARCH_COLUMNS = [
  'action',
  'module',
  'entity_label',
  'actor_email',
  'change_summary',
] as const;
const ACCESS_SEARCH_COLUMNS = [
  'event',
  'outcome',
  'route_name',
  'path',
  'method',
  'request_id',
  'trace_id',
  'actor_email',
  'failure_reason',
] as const;
const APPLICATION_SEARCH_COLUMNS = [
  'level',
  'category',
  'event',
  'module',
  'message',
  'actor_email',
] as const;

const AUDIT_FILTER_COLUMNS = {
  module: 'module',
  action: 'action',
  actorUserId: 'actor_user_id',
} as const;
const ACCESS_FILTER_COLUMNS = {
  event: 'event',
  outcome: 'outcome',
  traceId: 'trace_id',
  actorUserId: 'actor_user_id',
} as const;
const APPLICATION_FILTER_COLUMNS = {
  level: 'level',
  module: 'module',
  event: 'event',
  actorUserId: 'actor_user_id',
} as const;

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

interface WhereClause {
  where: string;
  params: unknown[];
}

function buildWhere(
  search: string,
  searchColumns: readonly string[],
  exactFilters: Array<[column: string, value: string]>,
): WhereClause {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (search !== '') {
    params.push(`%${escapeLikePattern(search)}%`);
    conditions.push(
      `concat_ws(' ', ${searchColumns.join(', ')}) ILIKE $${params.length} ESCAPE '\\'`,
    );
  }

  for (const [column, value] of exactFilters) {
    if (value !== '') {
      params.push(value);
      conditions.push(`${column} = $${params.length}`);
    }
  }

  return {
    where: conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

export class LogsRepository {
  private readonly readMode: ObservabilitySignalReadMode;
  private readonly clickhouse: ClickHouseLogsSignalReader | null;

  constructor(
    private readonly database?: DatabaseClient,
    private readonly telemetry?: TelemetryRuntime,
    options: LogsRepositoryOptions = {},
  ) {
    this.readMode = options.readMode ?? 'postgres';
    this.clickhouse =
      this.readMode === 'clickhouse' && options.clickhouseReader
        ? new ClickHouseLogsSignalReader(options.clickhouseReader)
        : null;
  }

  usesClickHouseSignalReads(): boolean {
    return this.readMode === 'clickhouse';
  }

  async listClickHouseAccessLogs(
    query: SignalAccessLogsQuery,
  ): Promise<SignalAccessLogsResult | null> {
    return this.clickhouse?.listAccessLogs(query) ?? null;
  }

  async listClickHouseApplicationLogs(
    query: SignalApplicationLogsQuery,
  ): Promise<SignalApplicationLogsResult | null> {
    return this.clickhouse?.listApplicationLogs(query) ?? null;
  }

  async listAuditTrails(query: {
    search: string;
    module: string;
    action: string;
    actorUserId: string;
    page: number;
    pageSize?: number;
  }): Promise<ListPage<AuditTrailItem>> {
    const clause = buildWhere(query.search, AUDIT_SEARCH_COLUMNS, [
      [AUDIT_FILTER_COLUMNS.module, query.module],
      [AUDIT_FILTER_COLUMNS.action, query.action],
      [AUDIT_FILTER_COLUMNS.actorUserId, query.actorUserId],
    ]);
    const rows = await this.listRows(
      '"logs"."audit_trails"',
      'id, action, module, entity_type, entity_id, entity_label, ' +
        'actor_email, actor_role, change_summary, audited_at::text AS audited_at',
      'audited_at',
      clause,
      query.page,
      query.pageSize ?? LOGS_PER_PAGE,
    );

    return {
      items: rows.items.map((row) => ({
        id: String(row.id),
        action: String(row.action),
        module: String(row.module),
        entityType: String(row.entity_type),
        entityId: String(row.entity_id),
        entityLabel: textOrNull(row.entity_label),
        actorEmail: textOrNull(row.actor_email),
        actorRole: textOrNull(row.actor_role),
        changeSummary: textOrNull(row.change_summary),
        auditedAt: isoFromDbTimestamp(String(row.audited_at)),
      })),
      total: rows.total,
    };
  }

  async auditTrailOptions(): Promise<{ modules: string[]; actions: string[] }> {
    return {
      modules: await this.distinctValues('"logs"."audit_trails"', 'module'),
      actions: await this.distinctValues('"logs"."audit_trails"', 'action'),
    };
  }

  async listAccessLogs(query: {
    search: string;
    event: string;
    outcome: string;
    traceId: string;
    actorUserId: string;
    page: number;
    pageSize?: number;
  }): Promise<ListPage<AccessLogItem>> {
    const clause = buildWhere(query.search, ACCESS_SEARCH_COLUMNS, [
      [ACCESS_FILTER_COLUMNS.event, query.event],
      [ACCESS_FILTER_COLUMNS.outcome, query.outcome],
      [ACCESS_FILTER_COLUMNS.traceId, query.traceId],
      [ACCESS_FILTER_COLUMNS.actorUserId, query.actorUserId],
    ]);
    const rows = await this.listRows(
      '"logs"."access_logs"',
      'event, outcome, route_name, path, method, http_status, request_id, ' +
        'trace_id, session_id, metadata, actor_email, failure_reason, ' +
        'accessed_at::text AS accessed_at',
      'accessed_at',
      clause,
      query.page,
      query.pageSize ?? LOGS_PER_PAGE,
    );

    return {
      items: rows.items.map(mapAccessLogRow),
      total: rows.total,
    };
  }

  async accessLogOptions(): Promise<{ events: string[]; outcomes: string[] }> {
    return {
      events: await this.distinctValues('"logs"."access_logs"', 'event'),
      outcomes: await this.distinctValues('"logs"."access_logs"', 'outcome'),
    };
  }

  async listApplicationLogs(query: {
    search: string;
    level: string;
    module: string;
    event: string;
    actorUserId: string;
    page: number;
    pageSize?: number;
  }): Promise<ListPage<ApplicationLogItem>> {
    const clause = buildWhere(query.search, APPLICATION_SEARCH_COLUMNS, [
      [APPLICATION_FILTER_COLUMNS.level, query.level],
      [APPLICATION_FILTER_COLUMNS.module, query.module],
      [APPLICATION_FILTER_COLUMNS.event, query.event],
      [APPLICATION_FILTER_COLUMNS.actorUserId, query.actorUserId],
    ]);
    const rows = await this.listRows(
      '"logs"."logging"',
      'id, level, channel, category, event, module, message, context, ' +
        'exception_class, exception_message, stack_trace, ' +
        'actor_user_id, actor_name, actor_email, ' +
        'occurred_at::text AS occurred_at, created_at::text AS created_at',
      'occurred_at',
      clause,
      query.page,
      query.pageSize ?? LOGS_PER_PAGE,
    );

    return {
      items: rows.items.map(mapApplicationLogRow),
      total: rows.total,
    };
  }

  async applicationLogOptions(): Promise<{
    levels: string[];
    modules: string[];
    events: string[];
  }> {
    return {
      levels: await this.distinctValues('"logs"."logging"', 'level'),
      modules: await this.distinctValues('"logs"."logging"', 'module'),
      events: await this.distinctValues('"logs"."logging"', 'event'),
    };
  }

  private async listRows(
    table: string,
    selectColumns: string,
    timeColumn: string,
    clause: WhereClause,
    page: number,
    pageSize: number,
  ): Promise<ListPage<Record<string, unknown>>> {
    if (!this.database) {
      return { items: [], total: 0 };
    }
    const database = this.database;

    const countRows = (await this.runQuery(
      'logs.count',
      async () =>
        await database.unsafe(
          `SELECT count(*)::int AS total FROM ${table}${clause.where}`,
          clause.params as never[],
        ),
    )) as Array<{ total: number }>;
    const total = Number(countRows[0]?.total ?? 0);

    const limitParam = clause.params.length + 1;
    const offsetParam = clause.params.length + 2;
    const items = (await this.runQuery(
      'logs.list',
      async () =>
        await database.unsafe(
          `SELECT ${selectColumns} FROM ${table}${clause.where} ` +
            `ORDER BY ${timeColumn} DESC, id DESC ` +
            `LIMIT $${limitParam} OFFSET $${offsetParam}`,
          [...clause.params, pageSize, (page - 1) * pageSize] as never[],
        ),
    )) as Array<Record<string, unknown>>;

    return { items, total };
  }

  private async distinctValues(
    table: string,
    column: string,
  ): Promise<string[]> {
    if (!this.database) {
      return [];
    }
    const database = this.database;

    const rows = (await this.runQuery(
      'logs.options',
      async () =>
        await database.unsafe(
          `SELECT DISTINCT ${column} AS value FROM ${table} ` +
            `WHERE ${column} IS NOT NULL ORDER BY ${column}`,
        ),
    )) as Array<{ value: unknown }>;

    return rows.map((row) => String(row.value));
  }

  private runQuery<T>(
    resourceName: string,
    action: () => Promise<T | undefined>,
  ): Promise<T | undefined> {
    if (!this.telemetry) return action();
    return this.telemetry.withSpan(
      {
        resourceKind: 'db.query',
        resourceName,
        operation: 'select',
      },
      action,
    );
  }
}
