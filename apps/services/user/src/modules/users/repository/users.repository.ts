import type { DatabaseClient } from '#project/database';
import { isoFromDbTimestamp } from '#project/logger';
import {
  type CreateUserInput,
  deriveUserStatus,
  type UpdateUserInput,
  type UserRecord,
  type UserStatusFilter,
  type UsersListQuery,
} from '../users.types';
import type {
  CreateConflict,
  StatusTimestampPatch,
  UsersModuleStatus,
  UsersPage,
} from './types/repository.types';

export const USERS_PER_PAGE = 25;

/**
 * Data access for "user"."users". Every value the caller supplies is bound as a
 * parameter; only names from the whitelists below are ever interpolated into
 * SQL text. The repository knows nothing about HTTP and opens no transaction of
 * its own: the service passes the transaction in as `executor` so a guard, a
 * mutation, and its audit write share one boundary.
 */

/** Whitelist: the only columns free text search may reach. */
const SEARCH_COLUMNS = ['name', 'email'] as const;

/** Whitelist: the only sort the list supports, matching the previous list. */
const ORDER_BY = 'name ASC, email ASC';

/**
 * The status and audit columns are timestamptz, so a plain ::text would render
 * in whatever time zone the session happens to carry. Shifting to UTC first
 * gives `isoFromDbTimestamp` the naive UTC shape it expects, so the API always
 * answers in ISO 8601 with a Z suffix regardless of server or client zone.
 */
const SELECT_COLUMNS = [
  'id',
  'name',
  'email',
  "(email_verified_at AT TIME ZONE 'UTC')::text AS email_verified_at",
  "(suspended_at AT TIME ZONE 'UTC')::text AS suspended_at",
  "(blocked_at AT TIME ZONE 'UTC')::text AS blocked_at",
  "(deleted_at AT TIME ZONE 'UTC')::text AS deleted_at",
  "(created_at AT TIME ZONE 'UTC')::text AS created_at",
  "(updated_at AT TIME ZONE 'UTC')::text AS updated_at",
].join(', ');

/**
 * Whitelist: status filter to SQL predicate. The predicates follow the derived
 * status precedence (deleted, then blocked, then suspended, then active), so a
 * blocked user who is also suspended is only ever counted as blocked.
 */
const STATUS_PREDICATES: Record<UserStatusFilter, string | null> = {
  '': 'deleted_at IS NULL',
  active: 'suspended_at IS NULL AND blocked_at IS NULL AND deleted_at IS NULL',
  suspended:
    'suspended_at IS NOT NULL AND blocked_at IS NULL AND deleted_at IS NULL',
  blocked: 'blocked_at IS NOT NULL AND deleted_at IS NULL',
  deleted: 'deleted_at IS NOT NULL',
  all: null,
};

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** A null timestamp stays null; everything else becomes ISO 8601 UTC. */
function isoOrNull(value: unknown): string | null {
  const text = textOrNull(value);

  return text === null ? null : isoFromDbTimestamp(text);
}

function mapUser(row: Record<string, unknown>): UserRecord {
  const timestamps = {
    suspendedAt: isoOrNull(row.suspended_at),
    blockedAt: isoOrNull(row.blocked_at),
    deletedAt: isoOrNull(row.deleted_at),
  };

  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    status: deriveUserStatus(timestamps),
    emailVerifiedAt: isoOrNull(row.email_verified_at),
    ...timestamps,
    createdAt: isoOrNull(row.created_at) ?? '',
    updatedAt: isoOrNull(row.updated_at),
  };
}

export class UsersRepository {
  constructor(private readonly database?: DatabaseClient) {}

  getModuleStatus(): UsersModuleStatus {
    return { status: 'ok', module: 'users' };
  }

  async list(query: UsersListQuery): Promise<UsersPage> {
    const database = this.requireDatabase();
    const conditions: string[] = [];
    const params: unknown[] = [];
    const statusPredicate = STATUS_PREDICATES[query.status];

    if (statusPredicate) {
      conditions.push(statusPredicate);
    }

    if (query.search !== '') {
      params.push(`%${escapeLikePattern(query.search)}%`);
      conditions.push(
        `concat_ws(' ', ${SEARCH_COLUMNS.join(', ')}) ILIKE $${params.length} ESCAPE '\\'`,
      );
    }

    const where =
      conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const countRows = (await database.unsafe(
      `SELECT count(*)::int AS total FROM "user"."users"${where}`,
      params as never[],
    )) as Array<{ total: number }>;
    const rows = (await database.unsafe(
      `SELECT ${SELECT_COLUMNS} FROM "user"."users"${where} ` +
        `ORDER BY ${ORDER_BY} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, USERS_PER_PAGE, (query.page - 1) * USERS_PER_PAGE] as never[],
    )) as Array<Record<string, unknown>>;

    return {
      items: rows.map(mapUser),
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async findById(
    id: string,
    executor?: DatabaseClient,
  ): Promise<UserRecord | null> {
    const database = this.requireDatabase(executor);
    const rows = (await database.unsafe(
      `SELECT ${SELECT_COLUMNS} FROM "user"."users" WHERE id = $1`,
      [id] as never[],
    )) as Array<Record<string, unknown>>;
    const row = rows[0];

    return row ? mapUser(row) : null;
  }

  /**
   * Locks the target row for the rest of the transaction, so a guard read and
   * the mutation that follows it cannot race another admin's request.
   */
  async findByIdForUpdate(
    id: string,
    executor: DatabaseClient,
  ): Promise<UserRecord | null> {
    const rows = (await executor.unsafe(
      `SELECT ${SELECT_COLUMNS} FROM "user"."users" WHERE id = $1 FOR UPDATE`,
      [id] as never[],
    )) as Array<Record<string, unknown>>;
    const row = rows[0];

    return row ? mapUser(row) : null;
  }

  /**
   * Both uniqueness checks happen inside the caller's transaction and lock the
   * rows they find, so the create path can name which one collided. The unique
   * constraints on id and email remain the backstop.
   *
   * Email is matched case insensitively and compared against every row,
   * including deleted ones, so a restore can never collide.
   */
  async findCreateConflict(
    input: CreateUserInput,
    executor: DatabaseClient,
  ): Promise<CreateConflict | null> {
    const rows = (await executor.unsafe(
      `SELECT id, email FROM "user"."users"
       WHERE id = $1 OR lower(email) = lower($2)
       FOR UPDATE`,
      [input.id, input.email] as never[],
    )) as Array<Record<string, unknown>>;

    if (rows.length === 0) {
      return null;
    }

    return rows.some((row) => String(row.id) === input.id)
      ? 'id_taken'
      : 'email_taken';
  }

  async insert(
    input: CreateUserInput,
    executor: DatabaseClient,
  ): Promise<UserRecord> {
    const rows = (await executor.unsafe(
      `INSERT INTO "user"."users" (id, name, email)
       VALUES ($1, $2, $3)
       RETURNING ${SELECT_COLUMNS}`,
      [input.id, input.name, input.email] as never[],
    )) as Array<Record<string, unknown>>;
    const row = rows[0];

    if (!row) {
      throw new Error('user insert returned no row');
    }

    return mapUser(row);
  }

  /** Name only; email and access are immutable through the user API. */
  async updateProfile(
    id: string,
    input: UpdateUserInput,
    executor: DatabaseClient,
  ): Promise<UserRecord | null> {
    const rows = (await executor.unsafe(
      `UPDATE "user"."users"
       SET name = COALESCE($2, name),
           updated_at = now()
       WHERE id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [id, input.name ?? null] as never[],
    )) as Array<Record<string, unknown>>;
    const row = rows[0];

    return row ? mapUser(row) : null;
  }

  /**
   * Sets or clears status timestamps. A column left out of the patch keeps its
   * current value, which is what makes restore return a user to the status they
   * had before deletion: only deleted_at is cleared.
   */
  async setStatusTimestamps(
    id: string,
    patch: StatusTimestampPatch,
    executor: DatabaseClient,
  ): Promise<UserRecord | null> {
    const columns: Record<keyof StatusTimestampPatch, string> = {
      suspendedAt: 'suspended_at',
      blockedAt: 'blocked_at',
      deletedAt: 'deleted_at',
    };
    const assignments: string[] = [];

    for (const [key, column] of Object.entries(columns) as Array<
      [keyof StatusTimestampPatch, string]
    >) {
      const value = patch[key];

      if (value === undefined) {
        continue;
      }

      assignments.push(`${column} = ${value === 'now' ? 'now()' : 'NULL'}`);
    }

    if (assignments.length === 0) {
      return this.findById(id, executor);
    }

    const rows = (await executor.unsafe(
      `UPDATE "user"."users"
       SET ${assignments.join(', ')}, updated_at = now()
       WHERE id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [id] as never[],
    )) as Array<Record<string, unknown>>;
    const row = rows[0];

    return row ? mapUser(row) : null;
  }

  private requireDatabase(executor?: DatabaseClient): DatabaseClient {
    const database = executor ?? this.database;

    if (!database) {
      throw new Error('user database is not configured');
    }

    return database;
  }
}
