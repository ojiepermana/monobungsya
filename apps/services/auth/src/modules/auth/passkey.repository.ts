import { type DatabaseClient, withTransaction } from '#project/database';
import {
  completeFirstFactor,
  incrementRateLimit,
  mapUser,
} from './auth.repository';
import type {
  AuthRepositoryDependencies,
  AuthUser,
  FirstFactorResult,
} from './auth.types';
import type {
  AssertionCheck,
  AttestationCheck,
  ChallengeType,
  ExcludedCredential,
  PasskeySummary,
  StoredCredential,
} from './passkey.types';

const PASSKEY_RATE_LIMIT_ATTEMPTS = 10;

export type RegisterCredentialOutcome =
  | { status: 'created'; credential: PasskeySummary }
  | { status: 'challenge_invalid' }
  | { status: 'limit_reached' }
  | { status: 'duplicate' }
  | { status: 'verification_failed'; reason: string };

export type AuthenticateOutcome =
  | ({ status: 'authenticated' } & Extract<
      FirstFactorResult,
      { status: 'authenticated' }
    >)
  | ({ status: 'mfa_required' } & Extract<
      FirstFactorResult,
      { status: 'mfa_required' }
    >)
  | { status: 'challenge_invalid' }
  | { status: 'unknown_credential' }
  | {
      status: 'counter_regression';
      credentialDatabaseId: string;
      userId: string;
    }
  | { status: 'verification_failed'; reason: string };

export interface RegisterCredentialInput {
  userId: string;
  challenge: string;
  maxCredentials: number;
  /** Runs the attestation check inside the challenge transaction. */
  check: () => Promise<AttestationCheck>;
}

export interface AuthenticateInput {
  challenge: string;
  credentialId: string;
  sessionTokenHash: string;
  /** Runs the assertion check inside the challenge transaction. */
  check: (credential: StoredCredential) => Promise<AssertionCheck>;
}

export class PasskeyRepository {
  private readonly database: DatabaseClient | undefined;

  constructor(dependencies?: AuthRepositoryDependencies) {
    this.database = dependencies?.database;
  }

  async findActiveUser(userId: string): Promise<AuthUser | null> {
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

  async issueChallenge(
    type: ChallengeType,
    userId: string | null,
    challenge: string,
    expiresAt: Date,
  ): Promise<void> {
    const database = this.requireDatabase();
    await database`
      INSERT INTO "auth"."webauthn_challenges" (type, user_id, challenge, expires_at)
      VALUES (${type}, ${userId}, ${challenge}, ${expiresAt})
    `;
  }

  async countCredentials(userId: string): Promise<number> {
    const database = this.requireDatabase();
    const [row] = await database`
      SELECT count(*)::integer AS count
      FROM "auth"."passkey_credentials"
      WHERE user_id = ${userId}
    `;

    return Number(row?.count ?? 0);
  }

  async listExcludedCredentials(userId: string): Promise<ExcludedCredential[]> {
    const database = this.requireDatabase();
    const rows = await database`
      SELECT credential_id, transports
      FROM "auth"."passkey_credentials"
      WHERE user_id = ${userId}
      ORDER BY created_at
    `;

    return rows.map((row: Record<string, unknown>) => ({
      credentialId: String(row.credential_id),
      transports: mapTransports(row.transports),
    }));
  }

  async listCredentials(userId: string): Promise<PasskeySummary[]> {
    const database = this.requireDatabase();
    const rows = await database`
      SELECT id, label, created_at, last_used_at, backup_state
      FROM "auth"."passkey_credentials"
      WHERE user_id = ${userId}
      ORDER BY created_at
    `;

    return rows.map(mapSummary);
  }

  /**
   * Consumes the registration challenge, checks the cap, runs the attestation
   * check, and stores the credential in one transaction. The challenge is
   * consumed even when the check fails, so it stays single use.
   */
  async registerCredential(
    input: RegisterCredentialInput,
  ): Promise<RegisterCredentialOutcome> {
    const database = this.requireDatabase();

    return withTransaction(database, async (transaction) => {
      const [challengeRow] = await transaction`
        UPDATE "auth"."webauthn_challenges"
        SET used_at = now()
        WHERE challenge = ${input.challenge}
          AND type = 'registration'
          AND user_id = ${input.userId}
          AND used_at IS NULL
          AND expires_at > now()
        RETURNING id
      `;

      if (!challengeRow) {
        return { status: 'challenge_invalid' as const };
      }

      // Serializes concurrent registrations for this user so the cap holds.
      const [userRow] = await transaction`
        SELECT id
        FROM "user"."users"
        WHERE id = ${input.userId}
          AND suspended_at IS NULL
          AND blocked_at IS NULL
          AND deleted_at IS NULL
        FOR UPDATE
      `;

      if (!userRow) {
        return { status: 'challenge_invalid' as const };
      }

      const [countRow] = await transaction`
        SELECT count(*)::integer AS count
        FROM "auth"."passkey_credentials"
        WHERE user_id = ${input.userId}
      `;

      if (Number(countRow?.count ?? 0) >= input.maxCredentials) {
        return { status: 'limit_reached' as const };
      }

      const checked = await input.check();

      if (checked.status !== 'ok') {
        return checked;
      }

      const credential = checked.credential;
      const [inserted] = await transaction`
        INSERT INTO "auth"."passkey_credentials" (
          user_id,
          credential_id,
          public_key,
          counter,
          transports,
          aaguid,
          label,
          backup_eligible,
          backup_state
        )
        VALUES (
          ${input.userId},
          ${credential.credentialId},
          ${credential.publicKey},
          ${credential.counter},
          ${
            credential.transports
              ? transaction.array(credential.transports, 'text')
              : null
          },
          ${credential.aaguid},
          ${credential.label},
          ${credential.backupEligible},
          ${credential.backupState}
        )
        ON CONFLICT (credential_id) DO NOTHING
        RETURNING id, label, created_at, last_used_at, backup_state
      `;

      if (!inserted) {
        return { status: 'duplicate' as const };
      }

      return { status: 'created' as const, credential: mapSummary(inserted) };
    });
  }

  /**
   * Consumes the authentication challenge, runs the assertion check against the
   * stored credential, then updates the counter and creates a session in one
   * transaction. The challenge is consumed even when the check fails.
   */
  async authenticate(input: AuthenticateInput): Promise<AuthenticateOutcome> {
    const database = this.requireDatabase();

    return withTransaction(database, async (transaction) => {
      const [challengeRow] = await transaction`
        UPDATE "auth"."webauthn_challenges"
        SET used_at = now()
        WHERE challenge = ${input.challenge}
          AND type = 'authentication'
          AND used_at IS NULL
          AND expires_at > now()
        RETURNING id
      `;

      if (!challengeRow) {
        return { status: 'challenge_invalid' as const };
      }

      const [credentialRow] = await transaction`
        SELECT
          credential.id,
          credential.user_id,
          credential.credential_id,
          credential.public_key,
          credential.counter,
          credential.transports
        FROM "auth"."passkey_credentials" AS credential
        JOIN "user"."users" AS user_record
          ON user_record.id = credential.user_id
        WHERE credential.credential_id = ${input.credentialId}
          AND user_record.suspended_at IS NULL
          AND user_record.blocked_at IS NULL
          AND user_record.deleted_at IS NULL
        FOR UPDATE OF credential
      `;

      if (!credentialRow) {
        return { status: 'unknown_credential' as const };
      }

      const credential: StoredCredential = {
        id: String(credentialRow.id),
        userId: String(credentialRow.user_id),
        credentialId: String(credentialRow.credential_id),
        publicKey: toUint8Array(credentialRow.public_key),
        counter: Number(credentialRow.counter),
        transports: mapTransports(credentialRow.transports),
      };
      const checked = await input.check(credential);

      if (checked.status === 'counter_regression') {
        return {
          status: 'counter_regression' as const,
          credentialDatabaseId: credential.id,
          userId: credential.userId,
        };
      }

      if (checked.status !== 'ok') {
        return checked;
      }

      await transaction`
        UPDATE "auth"."passkey_credentials"
        SET counter = ${checked.newCounter}, last_used_at = now(), updated_at = now()
        WHERE id = ${credential.id}
      `;

      const [userRow] = await transaction`
        SELECT
          user_record.id,
          user_record.email,
          user_record.name,
          user_record.suspended_at,
          user_record.totp_required_at,
          totp.confirmed_at
        FROM "user"."users" AS user_record
        LEFT JOIN "auth"."totp_credentials" AS totp
          ON totp.user_id = user_record.id
        WHERE user_record.id = ${credential.userId}
      `;

      if (!userRow) {
        return { status: 'unknown_credential' as const };
      }

      const firstFactor = await completeFirstFactor(
        transaction,
        userRow,
        input.sessionTokenHash,
        'passkey',
      );

      if (firstFactor.status === 'mfa_required') {
        return firstFactor;
      }

      return {
        status: 'authenticated' as const,
        user: firstFactor.user,
        session: firstFactor.session,
      };
    });
  }

  async renameCredential(
    userId: string,
    credentialDatabaseId: string,
    label: string,
  ): Promise<PasskeySummary | null> {
    const database = this.requireDatabase();
    const [row] = await database`
      UPDATE "auth"."passkey_credentials"
      SET label = ${label}, updated_at = now()
      WHERE id = ${credentialDatabaseId}
        AND user_id = ${userId}
      RETURNING id, label, created_at, last_used_at, backup_state
    `;

    return row ? mapSummary(row) : null;
  }

  async deleteCredential(
    userId: string,
    credentialDatabaseId: string,
  ): Promise<PasskeySummary | null> {
    const database = this.requireDatabase();
    const [row] = await database`
      DELETE FROM "auth"."passkey_credentials"
      WHERE id = ${credentialDatabaseId}
        AND user_id = ${userId}
      RETURNING id, label, created_at, last_used_at, backup_state
    `;

    return row ? mapSummary(row) : null;
  }

  async allowAttempt(ipHash: string): Promise<boolean> {
    const database = this.requireDatabase();

    return incrementRateLimit(
      database,
      'passkey_ip',
      ipHash,
      PASSKEY_RATE_LIMIT_ATTEMPTS,
    );
  }

  private requireDatabase(): DatabaseClient {
    if (!this.database) {
      throw new Error('auth database is not configured');
    }

    return this.database;
  }
}

function mapSummary(row: Record<string, unknown>): PasskeySummary {
  return {
    id: String(row.id),
    label: String(row.label),
    createdAt: new Date(String(row.created_at)).toISOString(),
    lastUsedAt: row.last_used_at
      ? new Date(String(row.last_used_at)).toISOString()
      : null,
    backupState: Boolean(row.backup_state),
  };
}

function mapTransports(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  return value.map((entry) => String(entry));
}

function toUint8Array(value: unknown): Uint8Array<ArrayBuffer> {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    const bytes = new Uint8Array(value.byteLength);
    bytes.set(value instanceof Uint8Array ? value : new Uint8Array(value));

    return bytes;
  }

  // A bytea column read back as text arrives in Postgres hex format.
  if (typeof value === 'string') {
    return Uint8Array.from(Buffer.from(value.replace(/^\\x/, ''), 'hex'));
  }

  throw new Error('stored passkey public key is not readable');
}
