import { type DatabaseClient, withTransaction } from '#project/database';
import { createSecret, hashSecret } from './auth.crypto';
import type { AuthSecurityContext } from './auth.notifications';
import type {
  AuthRepositoryDependencies,
  AuthUser,
  FirstFactorResult,
  MfaChallengePurpose,
  SessionIdentity,
  SessionRecord,
} from './auth.types';

export type AuthModuleStatus = {
  status: 'ok';
  module: 'auth';
};

export interface MagicLinkIssueResult {
  user: AuthUser | null;
  eligibility: MagicLinkEligibility;
  rateLimited: boolean;
}

export type MagicLinkEligibility =
  | 'not_registered'
  | 'inactive'
  | 'unverified'
  | 'active';

export type RateLimitKeyType =
  | 'email'
  | 'ip'
  | 'passkey_ip'
  | 'totp_ip'
  | 'totp_user';

export type { SessionRecord } from './auth.types';

export interface ConsumedSession extends SessionRecord {
  user: AuthUser;
}

export type SessionInspection = SessionIdentity | null;

export interface CleanupResult {
  loginTokens: number;
  sessions: number;
  rateLimits: number;
  webauthnChallenges: number;
  mfaChallenges: number;
  unconfirmedTotp: number;
}

export class AuthRepository {
  private readonly database: DatabaseClient | undefined;
  private readonly notificationSink: AuthRepositoryDependencies['notificationSink'];

  constructor(dependencies?: AuthRepositoryDependencies) {
    this.database = dependencies?.database;
    this.notificationSink = dependencies?.notificationSink;
  }

  getModuleStatus(): AuthModuleStatus {
    return { status: 'ok', module: 'auth' };
  }

  async issueMagicLink(
    email: string,
    emailHash: string,
    ipHash: string | undefined,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<MagicLinkIssueResult> {
    const database = this.requireDatabase();

    return withTransaction(database, async (transaction) => {
      const emailLimit = await incrementRateLimit(
        transaction,
        'email',
        emailHash,
      );
      const ipLimit = ipHash
        ? await incrementRateLimit(transaction, 'ip', ipHash)
        : true;

      if (!emailLimit || !ipLimit) {
        return {
          user: null,
          eligibility: 'not_registered',
          rateLimited: true,
        };
      }

      const [userRow] = await transaction`
        SELECT
          id,
          email,
          name,
          email_verified_at,
          suspended_at,
          blocked_at,
          deleted_at
        FROM "user"."users"
        WHERE lower(email) = ${email}
      `;

      if (!userRow) {
        return {
          user: null,
          eligibility: 'not_registered',
          rateLimited: false,
        };
      }

      if (
        userRow.suspended_at !== null ||
        userRow.blocked_at !== null ||
        userRow.deleted_at !== null
      ) {
        return {
          user: null,
          eligibility: 'inactive',
          rateLimited: false,
        };
      }

      if (userRow.email_verified_at === null) {
        return {
          user: null,
          eligibility: 'unverified',
          rateLimited: false,
        };
      }

      await transaction`
        INSERT INTO "auth"."login_tokens" (user_id, token_hash, expires_at)
        VALUES (${userRow.id}, ${tokenHash}, ${expiresAt})
      `;

      return {
        user: mapUser(userRow),
        eligibility: 'active',
        rateLimited: false,
      };
    });
  }

  /**
   * Issues a login token for an invitation, bypassing the rate limits the
   * public magic link route enforces: the caller is an admin creating a user
   * (spec docs/specs/0007-user-management, AC-2), not an anonymous request, so
   * no email or ip budget applies. The user must exist and be active.
   */
  async issueInvitationLink(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<AuthUser | null> {
    const database = this.requireDatabase();

    return withTransaction(database, async (transaction) => {
      const [userRow] = await transaction`
        SELECT id, email, name, suspended_at
        FROM "user"."users"
        WHERE id = ${userId}
          AND suspended_at IS NULL
          AND blocked_at IS NULL
          AND deleted_at IS NULL
      `;

      if (!userRow) {
        return null;
      }

      await transaction`
        UPDATE "auth"."login_tokens"
        SET used_at = now(), updated_at = now()
        WHERE user_id = ${userId}
          AND purpose = 'invitation'
          AND used_at IS NULL
          AND expires_at > now()
      `;

      await transaction`
        INSERT INTO "auth"."login_tokens" (
          user_id, token_hash, purpose, expires_at
        )
        VALUES (${userRow.id}, ${tokenHash}, 'invitation', ${expiresAt})
      `;

      return mapUser(userRow);
    });
  }

  async consumeMagicToken(
    tokenHash: string,
    sessionTokenHash: string,
    securityContext?: AuthSecurityContext,
  ): Promise<FirstFactorResult | null> {
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
          AND user_record.blocked_at IS NULL
          AND user_record.deleted_at IS NULL
        RETURNING token.id, token.user_id
      `;

      if (!tokenRow) {
        return null;
      }

      const [userRow] = await transaction`
        SELECT
          user_record.id,
          user_record.email,
          user_record.name,
          user_record.suspended_at,
          user_record.totp_required_at,
          credential.confirmed_at
        FROM "user"."users" AS user_record
        LEFT JOIN "auth"."totp_credentials" AS credential
          ON credential.user_id = user_record.id
        WHERE user_record.id = ${tokenRow.user_id}
      `;

      if (!userRow) {
        return null;
      }

      return completeFirstFactor(
        transaction,
        userRow,
        sessionTokenHash,
        'magic_link',
        this.notificationSink,
        securityContext,
      );
    });
  }

  async findSession(sessionTokenHash: string): Promise<SessionIdentity | null> {
    return this.inspectSession(sessionTokenHash);
  }

  async inspectSession(sessionTokenHash: string): Promise<SessionInspection> {
    const database = this.requireDatabase();
    const [row] = await database`
      WITH candidate AS (
        SELECT
          session.id AS session_id,
          session.idle_expires_at,
          session.absolute_expires_at,
          session.revoked_at,
          session.user_id,
          user_record.id,
          user_record.email,
          user_record.name,
          user_record.suspended_at,
          user_record.blocked_at,
          user_record.deleted_at,
          now() AS current_time
        FROM "auth"."sessions" AS session
        LEFT JOIN "user"."users" AS user_record
          ON user_record.id = session.user_id
        WHERE session.session_token_hash = ${sessionTokenHash}
      ), touched AS (
        UPDATE "auth"."sessions" AS session
        SET
          last_activity = candidate.current_time,
          idle_expires_at = LEAST(
            candidate.current_time + interval '8 hours',
            session.absolute_expires_at
          ),
          updated_at = candidate.current_time
        FROM candidate
        WHERE session.id = candidate.session_id
          AND candidate.revoked_at IS NULL
          AND candidate.idle_expires_at > candidate.current_time
          AND candidate.absolute_expires_at > candidate.current_time
          AND candidate.user_id IS NOT NULL
          AND candidate.id IS NOT NULL
          AND candidate.suspended_at IS NULL
          AND candidate.blocked_at IS NULL
          AND candidate.deleted_at IS NULL
        RETURNING session.id AS session_id,
          session.idle_expires_at,
          session.absolute_expires_at
      )
      SELECT candidate.*, touched.idle_expires_at AS touched_idle_expires_at,
        touched.absolute_expires_at AS touched_absolute_expires_at
      FROM candidate
      LEFT JOIN touched USING (session_id)
    `;

    if (!row) {
      return null;
    }

    if (isInvalidSession(row)) {
      return null;
    }

    const identity: SessionIdentity = {
      ...mapUser(row),
      sessionId: String(row.session_id),
      idleExpiresAt: new Date(String(row.touched_idle_expires_at)),
      absoluteExpiresAt: new Date(String(row.touched_absolute_expires_at)),
    };

    return identity;
  }

  async revokeSession(
    sessionTokenHash: string,
    securityContext?: AuthSecurityContext,
  ): Promise<void> {
    const database = this.requireDatabase();
    await withTransaction(database, async (transaction) => {
      const [row] = await transaction`
        UPDATE "auth"."sessions"
        SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
        WHERE session_token_hash = ${sessionTokenHash}
        RETURNING user_id
      `;
      if (row && securityContext) {
        await this.notificationSink?.enqueue(transaction, {
          userId: String(row.user_id),
          type: 'security.session_revoked',
          payload: {},
          context: securityContext,
        });
      }
    });
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
      const [webauthnChallenges] = await transaction`
        WITH deleted AS (
          DELETE FROM "auth"."webauthn_challenges"
          WHERE used_at IS NOT NULL OR expires_at <= now()
          RETURNING id
        )
        SELECT count(*)::integer AS count FROM deleted
      `;
      const [mfaChallenges] = await transaction`
        WITH deleted AS (
          DELETE FROM "auth"."mfa_challenges"
          WHERE used_at IS NOT NULL OR expires_at <= now()
          RETURNING id
        )
        SELECT count(*)::integer AS count FROM deleted
      `;
      const [unconfirmedTotp] = await transaction`
        WITH deleted AS (
          DELETE FROM "auth"."totp_credentials"
          WHERE confirmed_at IS NULL
            AND created_at <= now() - interval '24 hours'
          RETURNING id
        )
        SELECT count(*)::integer AS count FROM deleted
      `;

      return {
        loginTokens: Number(loginTokens?.count ?? 0),
        sessions: Number(sessions?.count ?? 0),
        rateLimits: Number(rateLimits?.count ?? 0),
        webauthnChallenges: Number(webauthnChallenges?.count ?? 0),
        mfaChallenges: Number(mfaChallenges?.count ?? 0),
        unconfirmedTotp: Number(unconfirmedTotp?.count ?? 0),
      };
    });
  }

  private requireDatabase(): DatabaseClient {
    if (!this.database) {
      throw new Error('auth database is not configured');
    }

    return this.database;
  }
}

export async function incrementRateLimit(
  database: DatabaseClient,
  keyType: RateLimitKeyType,
  keyHash: string,
  limit = 5,
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

  return Number(row?.attempts ?? 0) <= limit;
}

export async function insertSession(
  transaction: DatabaseClient,
  sessionTokenHash: string,
  userId: string,
): Promise<SessionRecord | null> {
  const [row] = await transaction`
    INSERT INTO "auth"."sessions" (
      session_token_hash,
      user_id,
      idle_expires_at,
      absolute_expires_at,
      last_activity
    )
    VALUES (
      ${sessionTokenHash},
      ${userId},
      now() + interval '8 hours',
      now() + interval '7 days',
      now()
    )
    RETURNING id, idle_expires_at, absolute_expires_at
  `;

  if (!row) {
    return null;
  }

  return {
    sessionId: String(row.id),
    idleExpiresAt: new Date(String(row.idle_expires_at)),
    absoluteExpiresAt: new Date(String(row.absolute_expires_at)),
  };
}

export function mapUser(row: Record<string, unknown>): AuthUser {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    suspendedAt: row.suspended_at ? new Date(String(row.suspended_at)) : null,
  };
}

/**
 * Completes the first factor without deciding whether a session is allowed
 * until the user's confirmed credential and requirement flag are read inside
 * the same transaction as the session or MFA challenge write.
 */
export async function completeFirstFactor(
  transaction: DatabaseClient,
  userRow: Record<string, unknown>,
  sessionTokenHash: string,
  method: 'magic_link' | 'passkey',
  notificationSink?: AuthRepositoryDependencies['notificationSink'],
  securityContext?: AuthSecurityContext,
): Promise<FirstFactorResult> {
  const user = mapUser(userRow);
  const totpEnabled = userRow.confirmed_at !== null;
  const required = userRow.totp_required_at !== null;

  if (totpEnabled || required) {
    const purpose: MfaChallengePurpose =
      required && !totpEnabled ? 'enroll' : 'login';
    const challengeToken = createSecret();

    await transaction`
      INSERT INTO "auth"."mfa_challenges" (
        user_id, purpose, token_hash, expires_at
      ) VALUES (
        ${user.id}, ${purpose}, ${hashSecret(challengeToken)},
        now() + interval '5 minutes'
      )
    `;

    return { status: 'mfa_required', user, challengeToken, purpose };
  }

  const session = await insertSession(transaction, sessionTokenHash, user.id);

  if (!session) {
    throw new Error(`Unable to create session after ${method} authentication`);
  }

  if (securityContext) {
    await notificationSink?.enqueue(transaction, {
      userId: user.id,
      type: 'security.sign_in',
      payload: {},
      context: securityContext,
    });
  }

  return { status: 'authenticated', user, session };
}

function isInvalidSession(row: Record<string, unknown>): boolean {
  const currentTime = new Date(String(row.current_time)).getTime();

  if (row.revoked_at !== null && row.revoked_at !== undefined) {
    return true;
  }
  if (new Date(String(row.absolute_expires_at)).getTime() <= currentTime) {
    return true;
  }
  if (new Date(String(row.idle_expires_at)).getTime() <= currentTime) {
    return true;
  }
  if (row.id === null || row.id === undefined) {
    return true;
  }
  if (row.deleted_at !== null && row.deleted_at !== undefined) {
    return true;
  }
  if (row.blocked_at !== null && row.blocked_at !== undefined) {
    return true;
  }
  if (row.suspended_at !== null && row.suspended_at !== undefined) {
    return true;
  }

  return false;
}
