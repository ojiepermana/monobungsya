import { type DatabaseClient, withTransaction } from '#project/database';
import type {
  AuthNotificationSink,
  AuthSecurityContext,
} from './auth.notifications';
import { incrementRateLimit, insertSession, mapUser } from './auth.repository';
import type {
  AuthRepositoryDependencies,
  AuthUser,
  MfaChallengePurpose,
  RecoveryCodeVerification,
  SessionRecord,
  TotpCredentialRecord,
  TotpStatus,
  TotpVerification,
} from './auth.types';

export type TotpCheck = TotpVerification | RecoveryCodeVerification | null;

export type TotpChallengeOutcome =
  | { status: 'authenticated'; user: AuthUser; session: SessionRecord }
  | { status: 'invalid' };

export type EnrollmentOutcome = {
  recoveryCodes: string[];
  session: SessionRecord | null;
};

export interface TotpRepositoryOptions extends AuthRepositoryDependencies {}

export class TotpRepository {
  private readonly database: DatabaseClient | undefined;
  private readonly notificationSink: AuthNotificationSink | undefined;

  constructor(dependencies?: TotpRepositoryOptions) {
    this.database = dependencies?.database;
    this.notificationSink = dependencies?.notificationSink;
  }

  async findUser(userId: string): Promise<AuthUser | null> {
    const database = this.requireDatabase();
    const [row] = await database`
      SELECT id, email, name, suspended_at
      FROM "user"."users"
      WHERE id = ${userId}
        AND suspended_at IS NULL
        AND blocked_at IS NULL
        AND deleted_at IS NULL
    `;

    return row ? mapUser(row) : null;
  }

  async getStatus(userId: string): Promise<TotpStatus> {
    const database = this.requireDatabase();
    const [row] = await database`
      SELECT
        credential.confirmed_at,
        user_record.totp_required_at,
        (
          SELECT count(*)
          FROM "auth"."totp_recovery_codes" AS recovery
          WHERE recovery.user_id = user_record.id
            AND recovery.used_at IS NULL
        )::integer AS recovery_codes_remaining
      FROM "user"."users" AS user_record
      LEFT JOIN "auth"."totp_credentials" AS credential
        ON credential.user_id = user_record.id
      WHERE user_record.id = ${userId}
    `;

    return {
      enabled: row?.confirmed_at !== null && row?.confirmed_at !== undefined,
      confirmedAt: row?.confirmed_at
        ? new Date(String(row.confirmed_at)).toISOString()
        : null,
      required:
        row?.totp_required_at !== null && row?.totp_required_at !== undefined,
      recoveryCodesRemaining: Number(row?.recovery_codes_remaining ?? 0),
    };
  }

  async getCredential(userId: string): Promise<TotpCredentialRecord | null> {
    const database = this.requireDatabase();
    const [row] = await database`
      SELECT
        credential.user_id,
        user_record.email,
        credential.secret_encrypted,
        credential.confirmed_at,
        credential.last_used_step
      FROM "auth"."totp_credentials" AS credential
      JOIN "user"."users" AS user_record
        ON user_record.id = credential.user_id
      WHERE credential.user_id = ${userId}
    `;

    return row ? mapCredential(row) : null;
  }

  async saveEnrollment(
    userId: string,
    secretEncrypted: string,
  ): Promise<boolean> {
    const database = this.requireDatabase();

    return withTransaction(database, async (transaction) => {
      const [existing] = await transaction`
        SELECT confirmed_at
        FROM "auth"."totp_credentials"
        WHERE user_id = ${userId}
        FOR UPDATE
      `;

      if (
        existing?.confirmed_at !== null &&
        existing?.confirmed_at !== undefined
      ) {
        return false;
      }

      await transaction`
        INSERT INTO "auth"."totp_credentials" (
          user_id, secret_encrypted, confirmed_at, last_used_step
        ) VALUES (${userId}, ${secretEncrypted}, NULL, NULL)
        ON CONFLICT (user_id)
        DO UPDATE SET
          secret_encrypted = EXCLUDED.secret_encrypted,
          confirmed_at = NULL,
          last_used_step = NULL,
          updated_at = now()
      `;

      return true;
    });
  }

  async confirmEnrollment(input: {
    userId: string;
    lastUsedStep: number;
    recoveryCodeHashes: string[];
    challengeTokenHash?: string;
    sessionTokenHash?: string;
    securityContext?: AuthSecurityContext;
  }): Promise<EnrollmentOutcome | null> {
    const database = this.requireDatabase();

    return withTransaction(database, async (transaction) => {
      const [credential] = await transaction`
        SELECT confirmed_at
        FROM "auth"."totp_credentials"
        WHERE user_id = ${input.userId}
        FOR UPDATE
      `;

      if (!credential || credential.confirmed_at !== null) {
        return null;
      }

      let session: SessionRecord | null = null;

      if (input.challengeTokenHash) {
        const [challenge] = await transaction`
          UPDATE "auth"."mfa_challenges"
          SET used_at = now()
          WHERE token_hash = ${input.challengeTokenHash}
            AND purpose = 'enroll'
            AND used_at IS NULL
            AND expires_at > now()
            AND attempts < 5
            AND user_id = ${input.userId}
          RETURNING id
        `;

        if (!challenge) {
          return null;
        }
      }

      await transaction`
        UPDATE "auth"."totp_credentials"
        SET confirmed_at = now(),
            last_used_step = ${input.lastUsedStep},
            updated_at = now()
        WHERE user_id = ${input.userId}
      `;
      await transaction`
        DELETE FROM "auth"."totp_recovery_codes"
        WHERE user_id = ${input.userId}
      `;
      for (const codeHash of input.recoveryCodeHashes) {
        await transaction`
          INSERT INTO "auth"."totp_recovery_codes" (user_id, code_hash)
          VALUES (${input.userId}, ${codeHash})
        `;
      }

      if (input.challengeTokenHash && input.sessionTokenHash) {
        session = await insertSession(
          transaction,
          input.sessionTokenHash,
          input.userId,
        );
      }

      if (input.securityContext) {
        await this.notificationSink?.enqueue(transaction, {
          userId: input.userId,
          type: 'security.totp_changed',
          payload: { action: 'diaktifkan' },
          context: input.securityContext,
        });
      }

      return { recoveryCodes: input.recoveryCodeHashes, session };
    });
  }

  async findChallenge(
    tokenHash: string,
    purpose: MfaChallengePurpose,
  ): Promise<{ userId: string } | null> {
    const database = this.requireDatabase();
    const [row] = await database`
      SELECT user_id
      FROM "auth"."mfa_challenges"
      WHERE token_hash = ${tokenHash}
        AND purpose = ${purpose}
        AND used_at IS NULL
        AND expires_at > now()
        AND attempts < 5
    `;

    return row ? { userId: String(row.user_id) } : null;
  }

  async allowAttempt(
    keyType: 'totp_ip' | 'totp_user',
    keyHash: string,
  ): Promise<boolean> {
    return incrementRateLimit(this.requireDatabase(), keyType, keyHash, 10);
  }

  async verifyChallenge(input: {
    tokenHash: string;
    sessionTokenHash: string;
    check: (credential: TotpCredentialRecord) => TotpCheck;
    securityContext?: AuthSecurityContext;
  }): Promise<TotpChallengeOutcome> {
    const database = this.requireDatabase();

    return withTransaction(database, async (transaction) => {
      const [challenge] = await transaction`
        SELECT id, user_id, attempts
        FROM "auth"."mfa_challenges"
        WHERE token_hash = ${input.tokenHash}
          AND purpose = 'login'
          AND used_at IS NULL
          AND expires_at > now()
          AND attempts < 5
        FOR UPDATE
      `;

      if (!challenge) {
        return { status: 'invalid' as const };
      }

      const [credential] = await transaction`
        SELECT
          totp.user_id,
          user_record.email,
          totp.secret_encrypted,
          totp.confirmed_at,
          totp.last_used_step
        FROM "auth"."totp_credentials" AS totp
        JOIN "user"."users" AS user_record
          ON user_record.id = totp.user_id
        WHERE totp.user_id = ${challenge.user_id}
          AND totp.confirmed_at IS NOT NULL
          AND user_record.suspended_at IS NULL
          AND user_record.blocked_at IS NULL
          AND user_record.deleted_at IS NULL
        FOR UPDATE OF totp
      `;

      if (!credential) {
        return { status: 'invalid' as const };
      }

      const checked = input.check(mapCredential(credential));

      if (!checked) {
        const attempts = Number(challenge.attempts) + 1;
        await transaction`
          UPDATE "auth"."mfa_challenges"
          SET attempts = ${attempts},
              used_at = CASE WHEN ${attempts} >= 5 THEN now() ELSE used_at END
          WHERE id = ${challenge.id}
        `;
        return { status: 'invalid' as const };
      }

      if (checked.kind === 'totp') {
        const previous = credential.last_used_step;
        if (previous !== null && BigInt(checked.step) <= BigInt(previous)) {
          const attempts = Number(challenge.attempts) + 1;
          await transaction`
            UPDATE "auth"."mfa_challenges"
            SET attempts = ${attempts},
                used_at = CASE WHEN ${attempts} >= 5 THEN now() ELSE used_at END
            WHERE id = ${challenge.id}
          `;
          return { status: 'invalid' as const };
        }

        await transaction`
          UPDATE "auth"."totp_credentials"
          SET last_used_step = ${checked.step}, updated_at = now()
          WHERE user_id = ${challenge.user_id}
        `;
      } else {
        const [recovery] = await transaction`
          UPDATE "auth"."totp_recovery_codes"
          SET used_at = now()
          WHERE user_id = ${challenge.user_id}
            AND code_hash = ${checked.codeHash}
            AND used_at IS NULL
          RETURNING id
        `;

        if (!recovery) {
          const attempts = Number(challenge.attempts) + 1;
          await transaction`
            UPDATE "auth"."mfa_challenges"
            SET attempts = ${attempts},
                used_at = CASE WHEN ${attempts} >= 5 THEN now() ELSE used_at END
            WHERE id = ${challenge.id}
          `;
          return { status: 'invalid' as const };
        }
      }

      await transaction`
        UPDATE "auth"."mfa_challenges"
        SET used_at = now()
        WHERE id = ${challenge.id}
      `;
      const session = await insertSession(
        transaction,
        input.sessionTokenHash,
        String(challenge.user_id),
      );
      const [userRow] = await transaction`
        SELECT id, email, name, suspended_at
        FROM "user"."users"
        WHERE id = ${challenge.user_id}
      `;

      if (!session || !userRow) {
        return { status: 'invalid' as const };
      }

      if (input.securityContext) {
        await this.notificationSink?.enqueue(transaction, {
          userId: String(challenge.user_id),
          type: 'security.sign_in',
          payload: {
            authMethod: checked.kind === 'recovery' ? 'recovery_code' : 'totp',
          },
          context: input.securityContext,
        });
      }

      return {
        status: 'authenticated' as const,
        user: mapUser(userRow),
        session,
      };
    });
  }

  async disable(
    userId: string,
    check: (credential: TotpCredentialRecord) => TotpCheck,
    securityContext?: AuthSecurityContext,
  ): Promise<boolean> {
    return this.mutateCredential(userId, check, 'disable', securityContext);
  }

  async regenerateRecoveryCodes(
    userId: string,
    check: (credential: TotpCredentialRecord) => TotpCheck,
    codeHashes: string[],
    securityContext?: AuthSecurityContext,
  ): Promise<boolean> {
    const database = this.requireDatabase();

    return withTransaction(database, async (transaction) => {
      const [row] = await transaction`
        SELECT
          totp.user_id,
          user_record.email,
          totp.secret_encrypted,
          totp.confirmed_at,
          totp.last_used_step
        FROM "auth"."totp_credentials" AS totp
        JOIN "user"."users" AS user_record ON user_record.id = totp.user_id
        WHERE totp.user_id = ${userId} AND totp.confirmed_at IS NOT NULL
        FOR UPDATE OF totp
      `;
      if (!row) return false;

      const checked = check(mapCredential(row));
      if (checked?.kind !== 'totp') return false;
      if (
        row.last_used_step !== null &&
        BigInt(checked.step) <= BigInt(row.last_used_step)
      ) {
        return false;
      }

      await transaction`
        UPDATE "auth"."totp_credentials"
        SET last_used_step = ${checked.step}, updated_at = now()
        WHERE user_id = ${userId}
      `;
      await transaction`
        DELETE FROM "auth"."totp_recovery_codes"
        WHERE user_id = ${userId}
      `;
      for (const codeHash of codeHashes) {
        await transaction`
          INSERT INTO "auth"."totp_recovery_codes" (user_id, code_hash)
          VALUES (${userId}, ${codeHash})
        `;
      }
      if (securityContext) {
        await this.notificationSink?.enqueue(transaction, {
          userId,
          type: 'security.totp_changed',
          payload: { action: 'kode pemulihan diperbarui' },
          context: securityContext,
        });
      }
      return true;
    });
  }

  async reset(
    userId: string,
    securityContext?: AuthSecurityContext,
  ): Promise<boolean> {
    const database = this.requireDatabase();

    return withTransaction(database, async (transaction) => {
      const [user] = await transaction`
        SELECT id FROM "user"."users" WHERE id = ${userId} FOR UPDATE
      `;
      if (!user) return false;

      await transaction`
        DELETE FROM "auth"."totp_credentials" WHERE user_id = ${userId}
      `;
      await transaction`
        DELETE FROM "auth"."totp_recovery_codes" WHERE user_id = ${userId}
      `;
      await transaction`
        DELETE FROM "auth"."mfa_challenges" WHERE user_id = ${userId}
      `;
      await transaction`
        UPDATE "auth"."sessions"
        SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
        WHERE user_id = ${userId}
      `;
      if (securityContext) {
        await this.notificationSink?.enqueue(transaction, {
          userId,
          type: 'security.totp_changed',
          payload: { action: 'direset' },
          context: securityContext,
        });
      }
      return true;
    });
  }

  private async mutateCredential(
    userId: string,
    check: (credential: TotpCredentialRecord) => TotpCheck,
    action: 'disable',
    securityContext?: AuthSecurityContext,
  ): Promise<boolean> {
    const database = this.requireDatabase();

    return withTransaction(database, async (transaction) => {
      const [row] = await transaction`
        SELECT
          totp.user_id,
          user_record.email,
          totp.secret_encrypted,
          totp.confirmed_at,
          totp.last_used_step
        FROM "auth"."totp_credentials" AS totp
        JOIN "user"."users" AS user_record ON user_record.id = totp.user_id
        WHERE totp.user_id = ${userId} AND totp.confirmed_at IS NOT NULL
        FOR UPDATE OF totp
      `;
      if (!row) return false;

      const checked = check(mapCredential(row));
      if (!checked) return false;

      if (checked.kind === 'recovery') {
        const [recovery] = await transaction`
          UPDATE "auth"."totp_recovery_codes"
          SET used_at = now()
          WHERE user_id = ${userId}
            AND code_hash = ${checked.codeHash}
            AND used_at IS NULL
          RETURNING id
        `;
        if (!recovery) return false;
      } else if (
        row.last_used_step !== null &&
        BigInt(checked.step) <= BigInt(row.last_used_step)
      ) {
        return false;
      } else {
        await transaction`
          UPDATE "auth"."totp_credentials"
          SET last_used_step = ${checked.step}, updated_at = now()
          WHERE user_id = ${userId}
        `;
      }

      if (action === 'disable') {
        await transaction`
          DELETE FROM "auth"."totp_credentials" WHERE user_id = ${userId}
        `;
        await transaction`
          DELETE FROM "auth"."totp_recovery_codes" WHERE user_id = ${userId}
        `;
        if (securityContext) {
          await this.notificationSink?.enqueue(transaction, {
            userId,
            type: 'security.totp_changed',
            payload: { action: 'dinonaktifkan' },
            context: securityContext,
          });
        }
      }

      return true;
    });
  }

  private requireDatabase(): DatabaseClient {
    if (!this.database) {
      throw new Error('auth database is not configured');
    }

    return this.database;
  }
}

function mapCredential(row: Record<string, unknown>): TotpCredentialRecord {
  return {
    userId: String(row.user_id),
    email: String(row.email),
    secretEncrypted: String(row.secret_encrypted),
    confirmedAt: row.confirmed_at ? new Date(String(row.confirmed_at)) : null,
    lastUsedStep:
      row.last_used_step === null || row.last_used_step === undefined
        ? null
        : BigInt(row.last_used_step as string | number | bigint),
  };
}
