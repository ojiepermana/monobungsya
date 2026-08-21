import { type DatabaseClient, withTransaction } from "#project/database";
import type {
  AuthRepositoryDependencies,
  AuthRole,
  AuthUser,
  SessionIdentity,
} from "./auth.types";

export type AuthModuleStatus = {
  status: "ok";
  module: "auth";
};

export interface MagicLinkIssueResult {
  user: AuthUser | null;
  rateLimited: boolean;
}

export interface ConsumedSession {
  user: AuthUser;
  sessionId: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface CleanupResult {
  loginTokens: number;
  sessions: number;
  rateLimits: number;
}

export class AuthRepository {
  private readonly database: DatabaseClient | undefined;

  constructor(dependencies?: AuthRepositoryDependencies) {
    this.database = dependencies?.database;
  }

  getModuleStatus(): AuthModuleStatus {
    return { status: "ok", module: "auth" };
  }

  async issueMagicLink(
    email: string,
    emailHash: string,
    ipHash: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<MagicLinkIssueResult> {
    const database = this.requireDatabase();

    return withTransaction(database, async (transaction) => {
      const emailLimit = await incrementRateLimit(
        transaction,
        "email",
        emailHash,
      );
      const ipLimit = await incrementRateLimit(transaction, "ip", ipHash);

      if (!emailLimit || !ipLimit) {
        return { user: null, rateLimited: true };
      }

      const [userRow] = await transaction`
        SELECT id, email, name, role, suspended_at
        FROM "user"."users"
        WHERE lower(email) = ${email}
          AND suspended_at IS NULL
      `;

      if (!userRow) {
        return { user: null, rateLimited: false };
      }

      await transaction`
        INSERT INTO "auth"."login_tokens" (user_id, token_hash, expires_at)
        VALUES (${userRow.id}, ${tokenHash}, ${expiresAt})
      `;

      return { user: mapUser(userRow), rateLimited: false };
    });
  }

  async consumeMagicToken(
    tokenHash: string,
    sessionTokenHash: string,
  ): Promise<ConsumedSession | null> {
    const database = this.requireDatabase();

    return withTransaction(database, async (transaction) => {
      const [tokenRow] = await transaction`
        UPDATE "auth"."login_tokens" AS token
        SET used_at = now(), updated_at = now()
        FROM "user"."users" AS user_record
        WHERE token.token_hash = ${tokenHash}
          AND token.used_at IS NULL
          AND token.expires_at > now()
          AND token.user_id = user_record.id
          AND user_record.suspended_at IS NULL
        RETURNING token.id, token.user_id
      `;

      if (!tokenRow) {
        return null;
      }

      const [sessionRow] = await transaction`
        INSERT INTO "auth"."sessions" (
          session_token_hash,
          user_id,
          idle_expires_at,
          absolute_expires_at,
          last_activity
        )
        VALUES (
          ${sessionTokenHash},
          ${tokenRow.user_id},
          now() + interval '8 hours',
          now() + interval '7 days',
          now()
        )
        RETURNING id, idle_expires_at, absolute_expires_at
      `;
      const [userRow] = await transaction`
        SELECT id, email, name, role, suspended_at
        FROM "user"."users"
        WHERE id = ${tokenRow.user_id}
      `;

      if (!sessionRow || !userRow) {
        return null;
      }

      return {
        user: mapUser(userRow),
        sessionId: String(sessionRow.id),
        idleExpiresAt: new Date(String(sessionRow.idle_expires_at)),
        absoluteExpiresAt: new Date(String(sessionRow.absolute_expires_at)),
      };
    });
  }

  async findSession(sessionTokenHash: string): Promise<SessionIdentity | null> {
    const database = this.requireDatabase();
    const [row] = await database`
      UPDATE "auth"."sessions" AS session
      SET
        last_activity = now(),
        idle_expires_at = LEAST(now() + interval '8 hours', session.absolute_expires_at),
        updated_at = now()
      FROM "user"."users" AS user_record
      WHERE session.session_token_hash = ${sessionTokenHash}
        AND session.revoked_at IS NULL
        AND session.idle_expires_at > now()
        AND session.absolute_expires_at > now()
        AND session.user_id = user_record.id
        AND user_record.suspended_at IS NULL
      RETURNING
        session.id AS session_id,
        session.idle_expires_at,
        session.absolute_expires_at,
        user_record.id,
        user_record.email,
        user_record.name,
        user_record.role,
        user_record.suspended_at
    `;

    if (!row) {
      return null;
    }

    return {
      ...mapUser(row),
      sessionId: String(row.session_id),
      idleExpiresAt: new Date(String(row.idle_expires_at)),
      absoluteExpiresAt: new Date(String(row.absolute_expires_at)),
    };
  }

  async revokeSession(sessionTokenHash: string): Promise<void> {
    const database = this.requireDatabase();
    await database`
      UPDATE "auth"."sessions"
      SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
      WHERE session_token_hash = ${sessionTokenHash}
    `;
  }

  async cleanup(): Promise<CleanupResult> {
    const database = this.requireDatabase();

    return withTransaction(database, async (transaction) => {
      const [loginTokens] = await transaction`
        WITH deleted AS (
          DELETE FROM "auth"."login_tokens"
          WHERE used_at IS NOT NULL OR expires_at <= now()
          RETURNING id
        )
        SELECT count(*)::integer AS count FROM deleted
      `;
      const [sessions] = await transaction`
        WITH deleted AS (
          DELETE FROM "auth"."sessions"
          WHERE revoked_at IS NOT NULL
            OR idle_expires_at <= now()
            OR absolute_expires_at <= now()
          RETURNING id
        )
        SELECT count(*)::integer AS count FROM deleted
      `;
      const [rateLimits] = await transaction`
        WITH deleted AS (
          DELETE FROM "auth"."auth_rate_limits"
          WHERE updated_at < now() - interval '1 day'
          RETURNING id
        )
        SELECT count(*)::integer AS count FROM deleted
      `;

      return {
        loginTokens: Number(loginTokens?.count ?? 0),
        sessions: Number(sessions?.count ?? 0),
        rateLimits: Number(rateLimits?.count ?? 0),
      };
    });
  }

  private requireDatabase(): DatabaseClient {
    if (!this.database) {
      throw new Error("auth database is not configured");
    }

    return this.database;
  }
}

async function incrementRateLimit(
  database: DatabaseClient,
  keyType: "email" | "ip",
  keyHash: string,
): Promise<boolean> {
  const [row] = await database`
    INSERT INTO "auth"."auth_rate_limits" (
      key_hash,
      key_type,
      window_started_at,
      attempts,
      updated_at
    )
    VALUES (${keyHash}, ${keyType}, now(), 1, now())
    ON CONFLICT (key_type, key_hash)
    DO UPDATE SET
      attempts = CASE
        WHEN "auth"."auth_rate_limits".window_started_at + interval '15 minutes' <= now()
          THEN 1
        ELSE "auth"."auth_rate_limits".attempts + 1
      END,
      window_started_at = CASE
        WHEN "auth"."auth_rate_limits".window_started_at + interval '15 minutes' <= now()
          THEN now()
        ELSE "auth"."auth_rate_limits".window_started_at
      END,
      updated_at = now()
    RETURNING attempts
  `;

  return Number(row?.attempts ?? 0) <= 5;
}

function mapUser(row: Record<string, unknown>): AuthUser {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: String(row.role) as AuthRole,
    suspendedAt: row.suspended_at ? new Date(String(row.suspended_at)) : null,
  };
}
