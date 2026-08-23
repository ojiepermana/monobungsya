import type { DatabaseClient } from '#project/database';
import { isoFromDbTimestamp } from '#project/logger';
import type {
  PermissionGrant,
  PermissionListQuery,
  PermissionListResult,
  PermissionRecord,
} from './access.types';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export class AccessRepository {
  constructor(private readonly database?: DatabaseClient) {}

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

function mapGrant(row: Record<string, unknown>): PermissionGrant {
  return {
    id: String(row.grant_id),
    permissionId: String(row.permission_id),
    userId: String(row.user_id),
    permission: mapPermission(row),
    createdAt: isoFromDbTimestamp(String(row.grant_created_at)),
  };
}
