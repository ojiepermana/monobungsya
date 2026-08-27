import type { DatabaseClient } from '#project/database';
import { isoFromDbTimestamp } from '#project/logger';
import type {
  GroupListQuery,
  GroupListResult,
  GroupRecord,
  PermissionGrant,
  PermissionListQuery,
  PermissionListResult,
  PermissionRecord,
} from './access.types';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;

export class AccessRepository {
  constructor(private readonly database?: DatabaseClient) {}

  async transaction<T>(
    operation: (
      repository: AccessRepository,
      transaction?: DatabaseClient,
    ) => Promise<T>,
  ): Promise<T> {
    const database = this.requireDatabase();
    return database.begin(async (transaction) =>
      operation(new AccessRepository(transaction), transaction),
    );
  }

  async lookupPermissions(userId: string): Promise<string[]> {
    const database = this.requireDatabase();
    const rows = await database`
      SELECT DISTINCT permission.name
      FROM "access"."permission_user" AS permission_user
      JOIN "access"."permission" AS permission
        ON permission.id = permission_user.permission_id
      WHERE permission_user.user_id = ${userId}
      ORDER BY permission.name ASC
    `;
    return rows.map((row: Record<string, unknown>) => String(row.name));
  }

  async listPermissions(
    query: PermissionListQuery,
  ): Promise<PermissionListResult> {
    const database = this.requireDatabase();
    const page = parsePositive(query.page, 1);
    const pageSize = Math.min(
      parsePositive(query.pageSize, DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    );
    const search = query.search?.trim() ?? '';
    const namespace = query.namespace?.trim() ?? '';
    const searchValue = `%${search}%`;
    const namespaceValue = namespace || null;
    const [countRow] = await database`
      SELECT count(*)::integer AS count
      FROM "access"."permission"
      WHERE (${search} = '' OR name ILIKE ${searchValue} OR code ILIKE ${searchValue} OR description ILIKE ${searchValue})
        AND (${namespaceValue}::text IS NULL OR namespace = ${namespaceValue})
    `;
    const rows = await database`
      SELECT permission.*,
        (permission.created_at AT TIME ZONE 'UTC')::text AS created_at,
        (permission.updated_at AT TIME ZONE 'UTC')::text AS updated_at,
        count(permission_user.id)::integer AS grant_count
      FROM "access"."permission" AS permission
      LEFT JOIN "access"."permission_user" AS permission_user
        ON permission_user.permission_id = permission.id
      WHERE (${search} = '' OR permission.name ILIKE ${searchValue} OR permission.code ILIKE ${searchValue} OR permission.description ILIKE ${searchValue})
        AND (${namespaceValue}::text IS NULL OR permission.namespace = ${namespaceValue})
      GROUP BY permission.id
      ORDER BY permission.namespace ASC, permission.resource ASC, permission.action ASC, permission.name ASC
      LIMIT ${pageSize}
      OFFSET ${(page - 1) * pageSize}
    `;
    const total = Number(countRow?.count ?? 0);
    return {
      data: rows.map(mapPermission),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      filters: { search, namespace },
    };
  }

  async findPermission(id: string): Promise<PermissionRecord | null> {
    const database = this.requireDatabase();
    const [row] = await database`
      SELECT permission.*,
        (permission.created_at AT TIME ZONE 'UTC')::text AS created_at,
        (permission.updated_at AT TIME ZONE 'UTC')::text AS updated_at,
        count(permission_user.id)::integer AS grant_count
      FROM "access"."permission" AS permission
      LEFT JOIN "access"."permission_user" AS permission_user
        ON permission_user.permission_id = permission.id
      WHERE permission.id = ${id}
      GROUP BY permission.id
    `;
    return row ? mapPermission(row) : null;
  }

  async findPermissionByNameOrCode(
    name: string,
    code: string,
  ): Promise<PermissionRecord | null> {
    const database = this.requireDatabase();
    const [row] = await database`
      SELECT permission.*,
        (permission.created_at AT TIME ZONE 'UTC')::text AS created_at,
        (permission.updated_at AT TIME ZONE 'UTC')::text AS updated_at,
        count(permission_user.id)::integer AS grant_count
      FROM "access"."permission" AS permission
      LEFT JOIN "access"."permission_user" AS permission_user
        ON permission_user.permission_id = permission.id
      WHERE permission.name = ${name} OR permission.code = ${code}
      GROUP BY permission.id
      LIMIT 1
    `;
    return row ? mapPermission(row) : null;
  }

  async listGroups(query: GroupListQuery): Promise<GroupListResult> {
    const database = this.requireDatabase();
    const page = parsePositive(query.page, 1);
    const pageSize = Math.min(
      parsePositive(query.pageSize, DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    );
    const search = query.search?.trim() ?? '';
    const status = query.status?.trim() || null;
    const deleted = normalizeDeletedFilter(query.deleted);
    const includeDeleted = deleted === 'include';
    const onlyDeleted = deleted === 'only';
    const appliable = query.appliable === 'true';
    const searchValue = `%${search}%`;

    const [countRow] = await database`
      SELECT count(*)::integer AS count
      FROM "access"."group" AS permission_group
      WHERE (${includeDeleted} OR permission_group.deleted_at IS NULL)
        AND (${!onlyDeleted} OR permission_group.deleted_at IS NOT NULL)
        AND (${search} = '' OR permission_group.name ILIKE ${searchValue}
          OR coalesce(permission_group.description, '') ILIKE ${searchValue})
        AND (${status}::text IS NULL OR permission_group.status = ${status})
        AND (
          NOT ${appliable}
          OR (
            permission_group.status = 'active'
            AND permission_group.deleted_at IS NULL
            AND EXISTS (
              SELECT 1
              FROM "access"."permission_group" AS group_permission
              WHERE group_permission.group_id = permission_group.id
            )
          )
        )
    `;
    const rows = await database`
      SELECT permission_group.*,
        (permission_group.created_at AT TIME ZONE 'UTC')::text AS created_at,
        (permission_group.updated_at AT TIME ZONE 'UTC')::text AS updated_at,
        (permission_group.deleted_at AT TIME ZONE 'UTC')::text AS deleted_at,
        count(group_permission.id)::integer AS permission_count
      FROM "access"."group" AS permission_group
      LEFT JOIN "access"."permission_group" AS group_permission
        ON group_permission.group_id = permission_group.id
      WHERE (${includeDeleted} OR permission_group.deleted_at IS NULL)
        AND (${!onlyDeleted} OR permission_group.deleted_at IS NOT NULL)
        AND (${search} = '' OR permission_group.name ILIKE ${searchValue}
          OR coalesce(permission_group.description, '') ILIKE ${searchValue})
        AND (${status}::text IS NULL OR permission_group.status = ${status})
        AND (
          NOT ${appliable}
          OR (
            permission_group.status = 'active'
            AND permission_group.deleted_at IS NULL
            AND EXISTS (
              SELECT 1
              FROM "access"."permission_group" AS eligible_permission
              WHERE eligible_permission.group_id = permission_group.id
            )
          )
        )
      GROUP BY permission_group.id
      ORDER BY permission_group.name ASC, permission_group.id ASC
      LIMIT ${pageSize}
      OFFSET ${(page - 1) * pageSize}
    `;
    const total = Number(countRow?.count ?? 0);
    return {
      data: rows.map(mapGroup),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      filters: { search, status: status ?? '', deleted, appliable },
    };
  }

  async findGroup(id: string): Promise<GroupRecord | null> {
    const database = this.requireDatabase();
    const [row] = await database`
      SELECT permission_group.*,
        (permission_group.created_at AT TIME ZONE 'UTC')::text AS created_at,
        (permission_group.updated_at AT TIME ZONE 'UTC')::text AS updated_at,
        (permission_group.deleted_at AT TIME ZONE 'UTC')::text AS deleted_at,
        count(group_permission.id)::integer AS permission_count
      FROM "access"."group" AS permission_group
      LEFT JOIN "access"."permission_group" AS group_permission
        ON group_permission.group_id = permission_group.id
      WHERE permission_group.id = ${id}
      GROUP BY permission_group.id
    `;
    return row ? mapGroup(row) : null;
  }

  async findGroupByName(name: string): Promise<{
    id: string;
    deletedAt: string | null;
  } | null> {
    const database = this.requireDatabase();
    const [row] = await database`
      SELECT id,
        (deleted_at AT TIME ZONE 'UTC')::text AS deleted_at
      FROM "access"."group"
      WHERE lower(name) = lower(${name})
      LIMIT 1
    `;
    if (!row) return null;
    return {
      id: String(row.id),
      deletedAt:
        row.deleted_at === null || row.deleted_at === undefined
          ? null
          : isoFromDbTimestamp(String(row.deleted_at)),
    };
  }

  async createGroup(input: {
    name: string;
    description: string | null;
    status?: string;
  }): Promise<GroupRecord> {
    const database = this.requireDatabase();
    const [row] = await database`
      INSERT INTO "access"."group" (name, status, description)
      VALUES (
        ${input.name},
        coalesce(${input.status ?? null}, 'active'),
        ${input.description}
      )
      RETURNING *,
        (created_at AT TIME ZONE 'UTC')::text AS created_at,
        (updated_at AT TIME ZONE 'UTC')::text AS updated_at,
        (deleted_at AT TIME ZONE 'UTC')::text AS deleted_at,
        0::integer AS permission_count
    `;
    return mapGroup(row);
  }

  async updateGroup(
    id: string,
    input: {
      name?: string;
      description?: string | null;
      status?: string;
    },
  ): Promise<GroupRecord | null> {
    const database = this.requireDatabase();
    const [row] = await database`
      UPDATE "access"."group"
      SET
        name = CASE WHEN ${input.name !== undefined}
          THEN ${input.name ?? null} ELSE name END,
        description = CASE WHEN ${input.description !== undefined}
          THEN ${input.description ?? null} ELSE description END,
        status = CASE WHEN ${input.status !== undefined}
          THEN ${input.status ?? null} ELSE status END,
        updated_at = now()
      WHERE id = ${id}
      RETURNING *,
        (created_at AT TIME ZONE 'UTC')::text AS created_at,
        (updated_at AT TIME ZONE 'UTC')::text AS updated_at,
        (deleted_at AT TIME ZONE 'UTC')::text AS deleted_at,
        (
          SELECT count(*)::integer
          FROM "access"."permission_group"
          WHERE group_id = "access"."group".id
        ) AS permission_count
    `;
    return row ? mapGroup(row) : null;
  }

  async softDeleteGroup(id: string): Promise<GroupRecord | null> {
    const database = this.requireDatabase();
    const [row] = await database`
      UPDATE "access"."group"
      SET deleted_at = now(), updated_at = now()
      WHERE id = ${id} AND deleted_at IS NULL
      RETURNING *,
        (created_at AT TIME ZONE 'UTC')::text AS created_at,
        (updated_at AT TIME ZONE 'UTC')::text AS updated_at,
        (deleted_at AT TIME ZONE 'UTC')::text AS deleted_at,
        (
          SELECT count(*)::integer
          FROM "access"."permission_group"
          WHERE group_id = "access"."group".id
        ) AS permission_count
    `;
    return row ? mapGroup(row) : null;
  }

  async restoreGroup(id: string): Promise<GroupRecord | null> {
    const database = this.requireDatabase();
    const [row] = await database`
      UPDATE "access"."group"
      SET deleted_at = NULL, updated_at = now()
      WHERE id = ${id} AND deleted_at IS NOT NULL
      RETURNING *,
        (created_at AT TIME ZONE 'UTC')::text AS created_at,
        (updated_at AT TIME ZONE 'UTC')::text AS updated_at,
        (deleted_at AT TIME ZONE 'UTC')::text AS deleted_at,
        (
          SELECT count(*)::integer
          FROM "access"."permission_group"
          WHERE group_id = "access"."group".id
        ) AS permission_count
    `;
    return row ? mapGroup(row) : null;
  }

  async listGroupPermissions(groupId: string): Promise<PermissionRecord[]> {
    const database = this.requireDatabase();
    const rows = await database`
      SELECT permission.*,
        (permission.created_at AT TIME ZONE 'UTC')::text AS created_at,
        (permission.updated_at AT TIME ZONE 'UTC')::text AS updated_at,
        0::integer AS grant_count
      FROM "access"."permission_group" AS group_permission
      JOIN "access"."permission" AS permission
        ON permission.id = group_permission.permission_id
      WHERE group_permission.group_id = ${groupId}
      ORDER BY permission.namespace ASC, permission.resource ASC, permission.name ASC
    `;
    return rows.map(mapPermission);
  }

  async existingGroupPermissionIds(
    groupId: string,
    permissionIds: readonly string[],
  ): Promise<string[]> {
    if (permissionIds.length === 0) return [];
    const database = this.requireDatabase();
    const rows = await database`
      SELECT permission_id
      FROM "access"."permission_group"
      WHERE group_id = ${groupId}
        AND permission_id = ANY(${database.array([...permissionIds], 'uuid')})
    `;
    return rows.map((row: Record<string, unknown>) =>
      String(row.permission_id),
    );
  }

  async attachGroupPermission(
    groupId: string,
    permissionId: string,
  ): Promise<boolean> {
    const database = this.requireDatabase();
    const [row] = await database`
      INSERT INTO "access"."permission_group" (group_id, permission_id)
      VALUES (${groupId}, ${permissionId})
      ON CONFLICT (group_id, permission_id) DO NOTHING
      RETURNING id
    `;
    return Boolean(row);
  }

  async detachGroupPermission(
    groupId: string,
    permissionId: string,
  ): Promise<boolean> {
    const database = this.requireDatabase();
    const result = await database`
      DELETE FROM "access"."permission_group"
      WHERE group_id = ${groupId} AND permission_id = ${permissionId}
    `;
    return result.count > 0;
  }

  async createPermission(input: {
    name: string;
    code: string;
    namespace: string;
    resource: string;
    action: string;
    scope: string | null;
    description: string | null;
  }): Promise<PermissionRecord> {
    const database = this.requireDatabase();
    const [row] = await database`
      INSERT INTO "access"."permission" (
        name, code, namespace, resource, action, scope, description
      ) VALUES (
        ${input.name}, ${input.code}, ${input.namespace}, ${input.resource},
        ${input.action}, ${input.scope}, ${input.description}
      )
      RETURNING *,
        (created_at AT TIME ZONE 'UTC')::text AS created_at,
        (updated_at AT TIME ZONE 'UTC')::text AS updated_at,
        0::integer AS grant_count
    `;
    return mapPermission(row);
  }

  async updateDescription(
    id: string,
    description: string | null,
  ): Promise<PermissionRecord | null> {
    const database = this.requireDatabase();
    const [row] = await database`
      UPDATE "access"."permission"
      SET description = ${description}, updated_at = now()
      WHERE id = ${id}
      RETURNING *,
        (created_at AT TIME ZONE 'UTC')::text AS created_at,
        (updated_at AT TIME ZONE 'UTC')::text AS updated_at,
        (
        SELECT count(*)::integer
        FROM "access"."permission_user"
        WHERE permission_id = "access"."permission".id
      ) AS grant_count
    `;
    return row ? mapPermission(row) : null;
  }

  async deletePermission(id: string): Promise<boolean> {
    const database = this.requireDatabase();
    const result = await database`
      DELETE FROM "access"."permission"
      WHERE id = ${id}
    `;
    return result.count > 0;
  }

  async listGrants(userId: string): Promise<PermissionGrant[]> {
    const database = this.requireDatabase();
    const rows = await database`
      SELECT
        permission_user.id AS grant_id,
        permission_user.permission_id,
        permission_user.user_id,
        (permission_user.created_at AT TIME ZONE 'UTC')::text AS grant_created_at,
        permission.*,
        (permission.created_at AT TIME ZONE 'UTC')::text AS created_at,
        (permission.updated_at AT TIME ZONE 'UTC')::text AS updated_at,
        0::integer AS grant_count
      FROM "access"."permission_user" AS permission_user
      JOIN "access"."permission" AS permission
        ON permission.id = permission_user.permission_id
      WHERE permission_user.user_id = ${userId}
      ORDER BY permission.namespace, permission.resource, permission.name
    `;
    return rows.map(mapGrant);
  }

  async findPermissionsByIds(
    ids: readonly string[],
  ): Promise<PermissionRecord[]> {
    if (ids.length === 0) return [];
    const database = this.requireDatabase();
    const rows = await database`
      SELECT *,
        (created_at AT TIME ZONE 'UTC')::text AS created_at,
        (updated_at AT TIME ZONE 'UTC')::text AS updated_at,
        0::integer AS grant_count
      FROM "access"."permission"
      WHERE id = ANY(${database.array([...ids], 'uuid')})
    `;
    return rows.map(mapPermission);
  }

  async existingGrantPermissionIds(
    userId: string,
    ids: readonly string[],
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    const database = this.requireDatabase();
    const rows = await database`
      SELECT permission_id
      FROM "access"."permission_user"
      WHERE user_id = ${userId}
        AND permission_id = ANY(${database.array([...ids], 'uuid')})
    `;
    return rows.map((row: Record<string, unknown>) =>
      String(row.permission_id),
    );
  }

  async insertGrant(
    userId: string,
    permissionId: string,
  ): Promise<string | null> {
    const database = this.requireDatabase();
    const [row] = await database`
      INSERT INTO "access"."permission_user" (permission_id, user_id)
      VALUES (${permissionId}, ${userId})
      ON CONFLICT (permission_id, user_id) DO NOTHING
      RETURNING id
    `;
    return row ? String(row.id) : null;
  }

  async revokeGrant(userId: string, permissionId: string): Promise<boolean> {
    const database = this.requireDatabase();
    const result = await database`
      DELETE FROM "access"."permission_user"
      WHERE user_id = ${userId} AND permission_id = ${permissionId}
    `;
    return result.count > 0;
  }

  async permissionForGrant(
    permissionId: string,
  ): Promise<PermissionRecord | null> {
    return this.findPermission(permissionId);
  }

  async sourcePermissionIds(userId: string): Promise<string[]> {
    const database = this.requireDatabase();
    const rows = await database`
      SELECT permission_id
      FROM "access"."permission_user"
      WHERE user_id = ${userId}
      ORDER BY permission_id
    `;
    return rows.map((row: Record<string, unknown>) =>
      String(row.permission_id),
    );
  }

  private requireDatabase(): DatabaseClient {
    if (!this.database) throw new Error('access database is not configured');
    return this.database;
  }
}

function parsePositive(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function mapPermission(row: Record<string, unknown>): PermissionRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    code: String(row.code),
    namespace: String(row.namespace),
    resource: String(row.resource),
    action: String(row.action),
    scope:
      row.scope === null || row.scope === undefined ? null : String(row.scope),
    description:
      row.description === null || row.description === undefined
        ? null
        : String(row.description),
    grantCount: Number(row.grant_count ?? 0),
    createdAt: isoFromDbTimestamp(String(row.created_at)),
    updatedAt: isoFromDbTimestamp(String(row.updated_at)),
  };
}

function mapGroup(row: Record<string, unknown>): GroupRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    status: row.status === 'off' ? 'off' : 'active',
    description:
      row.description === null || row.description === undefined
        ? null
        : String(row.description),
    permissionCount: Number(row.permission_count ?? 0),
    createdAt: isoFromDbTimestamp(String(row.created_at)),
    updatedAt: isoFromDbTimestamp(String(row.updated_at)),
    deletedAt:
      row.deleted_at === null || row.deleted_at === undefined
        ? null
        : isoFromDbTimestamp(String(row.deleted_at)),
  };
}

function mapGrant(row: Record<string, unknown>): PermissionGrant {
  return {
    id: String(row.grant_id),
    permissionId: String(row.permission_id),
    userId: String(row.user_id),
    permission: mapPermission(row),
    createdAt: isoFromDbTimestamp(String(row.grant_created_at)),
  };
}

function normalizeDeletedFilter(
  value: string | undefined,
): 'exclude' | 'include' | 'only' {
  return value === 'include' || value === 'only' ? value : 'exclude';
}
