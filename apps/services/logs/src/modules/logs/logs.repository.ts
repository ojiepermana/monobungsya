import type { DatabaseClient } from '#project/database';
import { isoFromDbTimestamp } from '#project/logger';
import type { AuditTrailItem } from './logs.types';

export const LOGS_PER_PAGE = 100;

interface ListPage<Item> {
  items: Item[];
  total: number;
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
const AUDIT_FILTER_COLUMNS = {
  module: 'module',
  action: 'action',
  actorUserId: 'actor_user_id',
} as const;
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
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
  constructor(private readonly database?: DatabaseClient) {}

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

    const countRows = (await this.database.unsafe(
      `SELECT count(*)::int AS total FROM ${table}${clause.where}`,
      clause.params as never[],
    )) as Array<{ total: number }>;
    const total = Number(countRows[0]?.total ?? 0);

    const limitParam = clause.params.length + 1;
    const offsetParam = clause.params.length + 2;
    const items = (await this.database.unsafe(
      `SELECT ${selectColumns} FROM ${table}${clause.where} ` +
        `ORDER BY ${timeColumn} DESC, id DESC ` +
        `LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...clause.params, pageSize, (page - 1) * pageSize] as never[],
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

    const rows = (await this.database.unsafe(
      `SELECT DISTINCT ${column} AS value FROM ${table} ` +
        `WHERE ${column} IS NOT NULL ORDER BY ${column}`,
    )) as Array<{ value: unknown }>;

    return rows.map((row) => String(row.value));
  }
}
