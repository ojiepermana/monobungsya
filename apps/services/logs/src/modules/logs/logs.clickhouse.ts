import { ValidationError } from '#project/errors';
import type {
  ClickHouseSignalReadDeadline,
  ClickHouseSignalReader,
} from '#project/observability';
import { canonicalJson, sha256 } from '#project/telemetry';
import { mapAccessLogRow, mapApplicationLogRow } from './logs.mapping';
import type {
  SignalAccessLogsQuery,
  SignalAccessLogsResult,
  SignalApplicationLogsQuery,
  SignalApplicationLogsResult,
  SignalLogRange,
} from './logs.types';

const PAGE_SIZE = 25;
const OPTION_LIMIT = 200;
const CURSOR_VERSION = 1;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/;

type ClickHouseScalar = string | number | boolean;
type ClickHouseParameters = Record<string, ClickHouseScalar>;
type SignalKind = 'application_log' | 'access_log';
type CursorDirection = 'next' | 'prev';

interface SignalCursor {
  version: number;
  signalKind: SignalKind;
  direction: CursorDirection;
  eventTime: string;
  stableId: string;
  filterFingerprint: string;
}

interface QuerySource {
  source: string;
  params: ClickHouseParameters;
}

function parameterTimestamp(value: Date): string {
  return value.toISOString().replace('T', ' ').replace('Z', '');
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function base64UrlEncode(value: string): string {
  return btoa(value)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid base64url');
  const padded = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return atob(padded);
}

function isCursorTimestamp(value: string): boolean {
  if (!CURSOR_TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value.slice(0, 10) &&
    parsed.toISOString().slice(11, 19) === value.slice(11, 19)
  );
}

function cursorFingerprint(
  signalKind: SignalKind,
  range: SignalLogRange,
  filters: Record<string, string>,
): string {
  return sha256(
    canonicalJson({
      version: CURSOR_VERSION,
      signalKind,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      filters,
      pageSize: PAGE_SIZE,
      sort: 'event_time_desc_stable_id_desc',
    }),
  );
}

function encodeCursor(
  signalKind: SignalKind,
  direction: CursorDirection,
  eventTime: string,
  stableId: string,
  filterFingerprint: string,
): string {
  return base64UrlEncode(
    JSON.stringify({
      version: CURSOR_VERSION,
      signalKind,
      direction,
      eventTime,
      stableId,
      filterFingerprint,
    } satisfies SignalCursor),
  );
}

function decodeCursor(
  value: string,
  signalKind: SignalKind,
  filterFingerprint: string,
): SignalCursor {
  try {
    const decoded = JSON.parse(base64UrlDecode(value)) as Partial<SignalCursor>;
    if (
      decoded.version !== CURSOR_VERSION ||
      decoded.signalKind !== signalKind ||
      (decoded.direction !== 'next' && decoded.direction !== 'prev') ||
      typeof decoded.eventTime !== 'string' ||
      !isCursorTimestamp(decoded.eventTime) ||
      typeof decoded.stableId !== 'string' ||
      !UUID_PATTERN.test(decoded.stableId) ||
      decoded.filterFingerprint !== filterFingerprint
    ) {
      throw new Error('invalid cursor');
    }
    return decoded as SignalCursor;
  } catch {
    throw new ValidationError(
      'The log cursor is invalid or does not match the filters',
    );
  }
}

function latestRows(
  table: 'application_logs' | 'access_logs',
  timeColumn: 'occurred_at' | 'accessed_at',
  range: SignalLogRange,
): QuerySource {
  return {
    source:
      `SELECT * FROM observability.${table} ` +
      `WHERE ${timeColumn} >= {from:DateTime64(6, 'UTC')} ` +
      `AND ${timeColumn} < {to:DateTime64(6, 'UTC')} ` +
      `ORDER BY id ASC, ${timeColumn} ASC, write_version DESC ` +
      `LIMIT 1 BY id, ${timeColumn}`,
    params: {
      from: parameterTimestamp(range.from),
      to: parameterTimestamp(range.to),
    },
  };
}

function searchCondition(columns: readonly string[]): string {
  return `(${columns
    .map(
      (column) =>
        `positionCaseInsensitiveUTF8(ifNull(${column}, ''), {search:String}) > 0`,
    )
    .join(' OR ')})`;
}

function where(conditions: readonly string[]): string {
  return conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
}

function rowCursor(
  row: Record<string, unknown>,
  timeColumn: 'occurred_at' | 'accessed_at',
): { eventTime: string; stableId: string } {
  const eventTime = String(row[timeColumn]);
  const stableId = String(row.id);
  if (!isCursorTimestamp(eventTime) || !UUID_PATTERN.test(stableId)) {
    throw new Error('ClickHouse log row has an invalid cursor boundary');
  }
  return { eventTime, stableId };
}

/**
 * The logs module owns these canonical ClickHouse read shapes. Tables, SQL
 * expressions, filters, and sort fields are all fixed internal allowlists;
 * callers supply only bound values.
 */
export class ClickHouseLogsSignalReader {
  constructor(private readonly reader: ClickHouseSignalReader) {}

  async listApplicationLogs(
    query: SignalApplicationLogsQuery,
  ): Promise<SignalApplicationLogsResult> {
    const deadline = this.reader.createDeadline({
      start: query.from,
      end: query.to,
    });
    const source = latestRows('application_logs', 'occurred_at', query);
    const filters = {
      search: query.search,
      level: query.level,
      module: query.module,
      event: query.event,
    };
    const fingerprint = cursorFingerprint('application_log', query, {
      ...filters,
      actorUserId: query.actorUserId,
    });
    const cursor = query.cursor
      ? decodeCursor(query.cursor, 'application_log', fingerprint)
      : null;
    const optionParams = { ...source.params };
    const optionConditions = this.actorConditions(
      query.actorUserId,
      optionParams,
    );
    const optionRows = await this.queryRows<{
      levels: unknown;
      modules: unknown;
      events: unknown;
    }>(
      `SELECT arraySort(groupUniqArray(${OPTION_LIMIT})(level)) AS levels, ` +
        `arraySort(groupUniqArray(${OPTION_LIMIT})(module)) AS modules, ` +
        `arraySort(groupUniqArray(${OPTION_LIMIT})(event)) AS events ` +
        `FROM (${source.source}) ${where(optionConditions)}`,
      query,
      optionParams,
      deadline,
    );
    const optionRow = optionRows[0];
    const dataParams = { ...source.params };
    const conditions = [
      ...this.actorConditions(query.actorUserId, dataParams),
      ...this.applicationFilterConditions(query, dataParams),
    ];
    const rows = await this.pageRows(
      { ...source, params: dataParams },
      query,
      'application_log',
      'occurred_at',
      fingerprint,
      cursor,
      'id, level, channel, category, event, module, message, context, ' +
        'exception_class, exception_message, stack_trace, actor_user_id, ' +
        'actor_name, actor_email, toString(occurred_at) AS occurred_at, ' +
        'toString(created_at) AS created_at',
      conditions,
      deadline,
    );
    return {
      data: rows.page.map(mapApplicationLogRow),
      ...rows.cursors,
      filters,
      options: {
        levels: stringArray(optionRow?.levels),
        modules: stringArray(optionRow?.modules),
        events: stringArray(optionRow?.events),
      },
      storageStatus: 'available',
      blindSpotSince: null,
    };
  }

  async listAccessLogs(
    query: SignalAccessLogsQuery,
  ): Promise<SignalAccessLogsResult> {
    const deadline = this.reader.createDeadline({
      start: query.from,
      end: query.to,
    });
    const source = latestRows('access_logs', 'accessed_at', query);
    const filters = {
      search: query.search,
      event: query.event,
      outcome: query.outcome,
      traceId: query.traceId,
    };
    const fingerprint = cursorFingerprint('access_log', query, {
      ...filters,
      actorUserId: query.actorUserId,
    });
    const cursor = query.cursor
      ? decodeCursor(query.cursor, 'access_log', fingerprint)
      : null;
    const optionParams = { ...source.params };
    const optionConditions = this.actorConditions(
      query.actorUserId,
      optionParams,
    );
    const optionRows = await this.queryRows<{
      events: unknown;
      outcomes: unknown;
    }>(
      `SELECT arraySort(groupUniqArray(${OPTION_LIMIT})(event)) AS events, ` +
        `arraySort(groupUniqArray(${OPTION_LIMIT})(outcome)) AS outcomes ` +
        `FROM (${source.source}) ${where(optionConditions)}`,
      query,
      optionParams,
      deadline,
    );
    const optionRow = optionRows[0];
    const dataParams = { ...source.params };
    const conditions = [
      ...this.actorConditions(query.actorUserId, dataParams),
      ...this.accessFilterConditions(query, dataParams),
    ];
    const rows = await this.pageRows(
      { ...source, params: dataParams },
      query,
      'access_log',
      'accessed_at',
      fingerprint,
      cursor,
      'id, event, outcome, route_name, path, method, http_status, request_id, ' +
        'trace_id, session_id, metadata, actor_email, failure_reason, ' +
        'toString(accessed_at) AS accessed_at',
      conditions,
      deadline,
    );
    return {
      data: rows.page.map(mapAccessLogRow),
      ...rows.cursors,
      filters,
      options: {
        events: stringArray(optionRow?.events),
        outcomes: stringArray(optionRow?.outcomes),
      },
      storageStatus: 'available',
      blindSpotSince: null,
    };
  }

  private actorConditions(
    actorUserId: string,
    params: ClickHouseParameters,
  ): string[] {
    if (!actorUserId) return [];
    params.actorUserId = actorUserId;
    return ['actor_user_id = {actorUserId:UUID}'];
  }

  private applicationFilterConditions(
    query: SignalApplicationLogsQuery,
    params: ClickHouseParameters,
  ): string[] {
    const conditions: string[] = [];
    if (query.search) {
      params.search = query.search;
      conditions.push(
        searchCondition([
          'level',
          'category',
          'event',
          'module',
          'message',
          'actor_email',
        ]),
      );
    }
    const add = (column: string, parameter: string, value: string) => {
      if (!value) return;
      params[parameter] = value;
      conditions.push(`${column} = {${parameter}:String}`);
    };
    add('level', 'level', query.level);
    add('module', 'module', query.module);
    add('event', 'event', query.event);
    return conditions;
  }

  private accessFilterConditions(
    query: SignalAccessLogsQuery,
    params: ClickHouseParameters,
  ): string[] {
    const conditions: string[] = [];
    if (query.search) {
      params.search = query.search;
      conditions.push(
        searchCondition([
          'event',
          'outcome',
          'route_name',
          'path',
          'method',
          'request_id',
          'trace_id',
          'actor_email',
          'failure_reason',
        ]),
      );
    }
    const add = (column: string, parameter: string, value: string) => {
      if (!value) return;
      params[parameter] = value;
      conditions.push(`${column} = {${parameter}:String}`);
    };
    add('event', 'event', query.event);
    add('outcome', 'outcome', query.outcome);
    add('trace_id', 'traceId', query.traceId);
    return conditions;
  }

  private async pageRows(
    source: QuerySource,
    query: SignalLogRange,
    signalKind: SignalKind,
    timeColumn: 'occurred_at' | 'accessed_at',
    fingerprint: string,
    cursor: SignalCursor | null,
    columns: string,
    conditions: string[],
    deadline: ClickHouseSignalReadDeadline,
  ): Promise<{
    page: Record<string, unknown>[];
    cursors: { prevCursor: string | null; nextCursor: string | null };
  }> {
    const params: ClickHouseParameters = {
      ...source.params,
      limit: PAGE_SIZE + 1,
    };
    let direction: CursorDirection = 'next';
    if (cursor) {
      direction = cursor.direction;
      params.cursorEventTime = cursor.eventTime;
      params.cursorStableId = cursor.stableId;
      conditions.push(
        direction === 'prev'
          ? `(${timeColumn}, id) > ({cursorEventTime:DateTime64(6, 'UTC')}, {cursorStableId:UUID})`
          : `(${timeColumn}, id) < ({cursorEventTime:DateTime64(6, 'UTC')}, {cursorStableId:UUID})`,
      );
    }
    const order =
      direction === 'prev'
        ? `ORDER BY ${timeColumn} ASC, id ASC`
        : `ORDER BY ${timeColumn} DESC, id DESC`;
    const rows = await this.queryRows<Record<string, unknown>>(
      `SELECT ${columns} FROM (${source.source}) ${where(conditions)} ` +
        `${order} LIMIT {limit:UInt32}`,
      query,
      params,
      deadline,
    );
    if (query.cursor && rows.length === 0) {
      throw new ValidationError('The log cursor has expired');
    }

    const hasMore = rows.length > PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    const page = direction === 'prev' ? pageRows.reverse() : pageRows;
    const first = page[0];
    const last = page.at(-1);
    const firstCursor = first ? rowCursor(first, timeColumn) : null;
    const lastCursor = last ? rowCursor(last, timeColumn) : null;
    return {
      page,
      cursors: {
        prevCursor:
          firstCursor &&
          ((direction === 'prev' && hasMore) ||
            (direction === 'next' && Boolean(query.cursor)))
            ? encodeCursor(
                signalKind,
                'prev',
                firstCursor.eventTime,
                firstCursor.stableId,
                fingerprint,
              )
            : null,
        nextCursor:
          lastCursor && (direction === 'prev' || hasMore)
            ? encodeCursor(
                signalKind,
                'next',
                lastCursor.eventTime,
                lastCursor.stableId,
                fingerprint,
              )
            : null,
      },
    };
  }

  private queryRows<Row extends object>(
    query: string,
    range: SignalLogRange,
    params: ClickHouseParameters,
    deadline?: ClickHouseSignalReadDeadline,
  ): Promise<Row[]> {
    return this.reader.queryRows(query, {
      range: { start: range.from, end: range.to },
      params,
      deadline,
    });
  }
}
